import { type BidEvaluation, BidEvaluationSchema } from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import type { DB } from '../db/index.js';

export const APPROVED_2026_CUTOFF_AT = '2026-09-30T17:00:00-04:00';
export const APPROVED_2026_CUTOFF_MS = Date.parse(APPROVED_2026_CUTOFF_AT);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const SourceImport = z
  .object({
    source: z.string().min(1),
    importId: z.string().min(1),
    revision: z.string().min(1),
    sha256: Hash,
    acceptedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const FreezeRow = z
  .object({
    id: z.string().min(1),
    bid_year: z.literal(2026),
    cutoff_at: z.literal(APPROVED_2026_CUTOFF_AT),
    time_zone: z.literal('America/New_York'),
    captured_at: z.number().int().min(APPROVED_2026_CUTOFF_MS),
    actor_subject: z.string().min(1),
    source_version_id: z.string().min(1),
    source_version_sha256: Hash,
    source_token: Hash,
    evaluation_json: z.string(),
    personnel_source_json: z.string(),
    credential_source_json: z.string(),
    evaluation_sha256: Hash,
    personnel_sha256: Hash,
    credential_sha256: Hash,
    source_imports_json: z.string(),
  })
  .strict();
export type BidEvidenceFreezeRow = z.infer<typeof FreezeRow>;

const canonical = (value: unknown) => canonicalize(JSON.parse(JSON.stringify(value)) as JsonValue);
const hash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)));
export function evidenceFreezeDigests(evaluation: BidEvaluation) {
  const evaluationJson = canonical(evaluation);
  return {
    evaluationJson,
    evaluationSha256: hash(evaluationJson),
  };
}

/** Preserve dated source rows as well as the evaluated eligibility projection.
 * These private JSON documents retain effective, expiration and import facts. */
export function evidenceSourceDigests(evidence: unknown) {
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence))
    throw new Error('bid_evidence_freeze_source_invalid');
  const rows = evidence as Record<string, unknown>;
  const pick = (keys: readonly string[]) =>
    Object.fromEntries(
      keys.map((key) => {
        if (!Object.hasOwn(rows, key) || rows[key] === undefined)
          throw new Error('bid_evidence_freeze_source_incomplete');
        return [key, rows[key]];
      }),
    );
  const personnelSourceJson = canonical(
    pick([
      'memberRows',
      'personnelEventRows',
      'serviceRows',
      'staffingRows',
      'assignmentRows',
      'assignmentImportRowEvidence',
      'tenureRows',
      'acceptedBaseline',
      'ordinalDatasets',
      'bidTourRows',
    ]),
  );
  const credentialSourceJson = canonical(
    pick(['credentialRows', 'qualificationEventRows', 'catalogRows', 'disputedRows']),
  );
  return {
    personnelSourceJson,
    credentialSourceJson,
    personnelSha256: hash(personnelSourceJson),
    credentialSha256: hash(credentialSourceJson),
  };
}

/** Convert a prepared run to evidence without carrying its temporary session pin. */
export function frozenEvaluationFromRun(snapshot: Record<string, unknown>) {
  const {
    v: _v,
    ruleBookRevision: _ruleBookRevision,
    configurationRevision: _configurationRevision,
    annualPolicyEvidence: _annualPolicyEvidence,
    bidDefinition: _bidDefinition,
    ...evaluation
  } = snapshot;
  return BidEvaluationSchema.parse(evaluation);
}

export async function loadBidEvidenceFreeze(database: DB, year: number) {
  const raw = await database.get(sql`SELECT * FROM bid_evidence_freezes WHERE bid_year=${year}`);
  if (!raw) return null;
  const row = FreezeRow.parse(raw);
  const evaluation = BidEvaluationSchema.parse(JSON.parse(row.evaluation_json));
  const digests = evidenceFreezeDigests(evaluation);
  const personnelSha256 = hash(canonical(JSON.parse(row.personnel_source_json)));
  const credentialSha256 = hash(canonical(JSON.parse(row.credential_source_json)));
  if (
    row.evaluation_json !== digests.evaluationJson ||
    row.evaluation_sha256 !== digests.evaluationSha256 ||
    row.personnel_sha256 !== personnelSha256 ||
    row.credential_sha256 !== credentialSha256
  )
    throw new Error('bid_evidence_freeze_integrity_failed');
  const sourceImports = z.array(SourceImport).min(1).parse(JSON.parse(row.source_imports_json));
  if (sourceImports.some((source) => Date.parse(source.acceptedAt) > APPROVED_2026_CUTOFF_MS))
    throw new Error('bid_evidence_freeze_source_after_cutoff');
  return { row, evaluation, sourceImports };
}
