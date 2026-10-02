import {
  BidEvaluationSchema,
  BidEvidenceFreezeSchema,
  ReviewedBidEvidenceUpdateSchema,
} from '@mbfd/shared';
import type { BidDefinitionContent, ReviewedBidEvidenceUpdate } from '@mbfd/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import type { DB } from '../db/index.js';
import { withOctober1ReviewedSourceDecision } from './2026-latest-source-cutoff.js';
import { bidContentHash } from './bid-definition-content.js';
import { loadBidDefinitionVersionFromDb } from './bid-definition-version.js';
import {
  BidEvidenceFreezeRowSchema,
  BidEvidenceSourceImportSchema,
  evidenceFreezeDigests,
  loadBidEvidenceFreeze,
} from './bid-evidence-freeze.js';
import { decodeBidEvidenceDocument } from './bid-evidence-storage.js';
import { unresolvedQualificationHolds } from './qualification-review-hold.js';

const canonical = (value: unknown) => canonicalize(JSON.parse(JSON.stringify(value)) as JsonValue);
const Stored = BidEvidenceFreezeRowSchema.extend({
  kind: z.literal('APPROVED_LEDGER_UPDATE'),
  original_freeze_id: z.string().min(1),
  reason: z.string().trim().min(4).max(1000),
  provenance_json: z.string(),
  idempotency_key: z.string().min(1),
}).strict();

export async function loadReviewedBidEvidenceUpdate(db: DB, year: number, id: string) {
  const raw = await db.get<Record<string, unknown>>(
    sql`SELECT * FROM bid_evidence_reviewed_updates WHERE bid_year=${year} AND id=${id}`,
  );
  if (!raw) return null;
  const stored = Stored.parse(raw);
  const original = await loadBidEvidenceFreeze(db, year);
  const version = await loadBidDefinitionVersionFromDb(db, year, stored.source_version_id);
  const provenance = ReviewedBidEvidenceUpdateSchema.parse(JSON.parse(stored.provenance_json));
  const sourceDecisions = version.ok
    ? withOctober1ReviewedSourceDecision(version.content.sourceDecisions)
    : null;
  if (
    !original ||
    !version.ok ||
    !sourceDecisions ||
    bidContentHash(canonical(sourceDecisions)) !== provenance.sourceDecisionsSha256 ||
    version.sha256 !== stored.source_version_sha256 ||
    stored.original_freeze_id !== original.row.id ||
    provenance.originalFreezeId !== original.row.id ||
    provenance.originalEvaluationSha256 !== original.row.evaluation_sha256 ||
    provenance.originalPersonnelSha256 !== original.row.personnel_sha256 ||
    provenance.originalCredentialSha256 !== original.row.credential_sha256 ||
    provenance.sourceToken !== stored.source_token ||
    provenance.observedAsOfAt !== new Date(stored.captured_at).toISOString() ||
    provenance.reasonSha256 !== bidContentHash(stored.reason)
  )
    throw new Error('bid_evidence_reviewed_update_integrity_failed');
  const row = {
    ...BidEvidenceFreezeRowSchema.parse(
      Object.fromEntries(
        Object.keys(BidEvidenceFreezeRowSchema.shape).map((key) => [key, raw[key]]),
      ),
    ),
    evaluation_json: decodeBidEvidenceDocument(stored.evaluation_json),
    personnel_source_json: decodeBidEvidenceDocument(stored.personnel_source_json),
    credential_source_json: decodeBidEvidenceDocument(stored.credential_source_json),
  };
  const evaluation = BidEvaluationSchema.parse(JSON.parse(row.evaluation_json));
  const sourceImports = z
    .array(BidEvidenceSourceImportSchema)
    .min(1)
    .parse(JSON.parse(row.source_imports_json));
  const credentials = JSON.parse(row.credential_source_json);
  if (
    !Array.isArray(credentials.qualificationHolds) ||
    evidenceFreezeDigests(evaluation).evaluationJson !== row.evaluation_json ||
    evidenceFreezeDigests(evaluation).evaluationSha256 !== row.evaluation_sha256 ||
    bidContentHash(canonical(JSON.parse(row.personnel_source_json))) !== row.personnel_sha256 ||
    bidContentHash(canonical(credentials)) !== row.credential_sha256 ||
    sourceImports.some((source) => Date.parse(source.acceptedAt) > row.captured_at)
  )
    throw new Error('bid_evidence_reviewed_update_integrity_failed');
  const receipt = await db.get<{
    actor_subject: string;
    operation: string;
    request_json: string;
    response_json: string;
  }>(
    sql`SELECT actor_subject,operation,request_json,response_json FROM admin_configuration_receipts WHERE idempotency_key=${stored.idempotency_key}`,
  );
  const expected = receipt ? JSON.parse(receipt.request_json).expected : null;
  const response = receipt ? JSON.parse(receipt.response_json) : null;
  if (
    !receipt ||
    receipt.actor_subject !== stored.actor_subject ||
    receipt.operation !== 'bid-evidence-reviewed-update' ||
    expected?.versionId !== row.source_version_id ||
    expected?.sha256 !== row.source_version_sha256 ||
    expected?.sourceToken !== row.source_token ||
    expected?.originalFreezeId !== stored.original_freeze_id ||
    JSON.parse(receipt.request_json).reason !== stored.reason ||
    canonical(response) !==
      canonical(
        publicReviewedBidEvidenceUpdate({
          row,
          sourceImports,
          reviewedUpdate: provenance,
          sourceDecisions,
          reason: stored.reason,
        }),
      )
  )
    throw new Error('bid_evidence_reviewed_update_receipt_invalid');
  return { row, evaluation, sourceImports, reviewedUpdate: provenance, response, sourceDecisions };
}

export function publicReviewedBidEvidenceUpdate(input: {
  row: z.infer<typeof BidEvidenceFreezeRowSchema>;
  sourceImports: z.infer<typeof BidEvidenceSourceImportSchema>[];
  reviewedUpdate: ReviewedBidEvidenceUpdate;
  sourceDecisions: BidDefinitionContent['sourceDecisions'];
  reason: string;
}) {
  const { row, sourceImports, reviewedUpdate, sourceDecisions, reason } = input;
  const evaluation = BidEvaluationSchema.parse(JSON.parse(row.evaluation_json));
  const personnel = JSON.parse(row.personnel_source_json);
  const credentials = JSON.parse(row.credential_source_json);
  const events = credentials.qualificationEventRows.map(
    (event: {
      memberId: number;
      credentialId: number | null;
      createdAt: string;
      effectiveOn: string;
    }) => ({ ...event, createdAt: new Date(event.createdAt).getTime() }),
  );
  const dates = evaluation.settings;
  if (dates.v !== 3 || !dates.personnelEvaluationOn)
    throw new Error('reviewed_update_dates_missing');
  const holds = unresolvedQualificationHolds(
    credentials.qualificationHolds,
    events,
    dates.credentialEvaluationOn,
  );
  return {
    update: {
      freezeId: row.id,
      evidenceCutoffAt: row.cutoff_at,
      capturedAt: reviewedUpdate.observedAsOfAt,
      sourceVersionId: row.source_version_id,
      sourceVersionSha256: row.source_version_sha256,
      evaluationSha256: row.evaluation_sha256,
      personnelSha256: row.personnel_sha256,
      credentialSha256: row.credential_sha256,
      sourceImports,
      counts: {
        members: personnel.memberRows.length,
        approvedQualificationEvents: credentials.qualificationEventRows.length,
        pendingQualificationHolds: holds.length,
      },
      eligibilityDates: {
        credentialEvaluationOn: dates.credentialEvaluationOn,
        personnelEvaluationOn: dates.personnelEvaluationOn,
      },
      reason,
      actorSubject: row.actor_subject,
      freezePin: reviewedBidEvidenceFreezePin({ row, sourceImports, reviewedUpdate }),
      sourceDecisions,
    },
  };
}

/** Exact pins resolve immutable observations. Year-only calls keep the
 * historical original semantics and never select a newer observation. */
export async function loadPinnedBidEvidenceFreeze(db: DB, year: number, id: string) {
  const original = await loadBidEvidenceFreeze(db, year);
  if (original?.row.id === id)
    return { ...original, reviewedUpdate: undefined, sourceDecisions: undefined };
  return loadReviewedBidEvidenceUpdate(db, year, id);
}

export function reviewedBidEvidenceFreezePin(input: {
  row: z.infer<typeof BidEvidenceFreezeRowSchema>;
  sourceImports: z.infer<typeof BidEvidenceSourceImportSchema>[];
  reviewedUpdate: z.infer<typeof ReviewedBidEvidenceUpdateSchema>;
}) {
  const { row, sourceImports, reviewedUpdate } = input;
  const capturedAt = new Date(row.captured_at).toISOString();
  return BidEvidenceFreezeSchema.parse({
    freezeId: row.id,
    evaluationSha256: row.evaluation_sha256,
    sourceVersionId: row.source_version_id,
    sourceVersionSha256: row.source_version_sha256,
    evidenceCutoffAt: row.cutoff_at,
    timeZone: row.time_zone,
    approvedAt: capturedAt,
    sourceImports,
    personnelSnapshot: { sha256: row.personnel_sha256, asOfAt: capturedAt, capturedAt },
    credentialSnapshot: { sha256: row.credential_sha256, asOfAt: capturedAt, capturedAt },
    reviewedUpdate,
  });
}
