import { ReviewedBidEvidenceUpdateSchema } from '@mbfd/shared';
import { ulid } from 'ulid';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import {
  latest2026ReviewedSourceUpdateIssue,
  withOctober1ReviewedSourceDecision,
} from './2026-latest-source-cutoff.js';
import {
  configurationReceiptStatement,
  loadConfigurationReceipt,
} from './admin-configuration-receipt.js';
import { bidContentHash } from './bid-definition-content.js';
import { compileBidDefinitionStagePolicy } from './bid-definition-context.js';
import { prepareBidDefinitionRun } from './bid-definition-run.js';
import { captureBidDefinitionControl } from './bid-definition-source.js';
import { loadBidDefinitionHead, loadBidDefinitionVersion } from './bid-definition-version.js';
import {
  APPROVED_2026_CUTOFF_AT,
  evidenceFreezeDigests,
  evidenceSourceDigests,
  loadBidEvidenceFreeze,
} from './bid-evidence-freeze.js';
import {
  loadReviewedBidEvidenceUpdate,
  publicReviewedBidEvidenceUpdate,
} from './bid-evidence-reviewed-update-storage.js';
import { encodeBidEvidenceDocument } from './bid-evidence-storage.js';
import {
  loadBidEvaluationEvidence,
  loadExplicitBidPolicySource,
  loadPersistedBidEvaluationMaterial,
  prepareCapturedBidEvaluation,
} from './bid-policy.js';
import { unresolvedQualificationHolds } from './qualification-review-hold.js';

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ReviewedBidEvidenceUpdateExpectedSchema = z
  .object({
    versionId: z.string().min(1),
    revision: z.number().int().positive(),
    sha256: Hash,
    sourceToken: Hash,
    originalFreezeId: z.string().min(1),
  })
  .strict();
export const ReviewedBidEvidenceUpdateRequestSchema = z
  .object({
    expected: ReviewedBidEvidenceUpdateExpectedSchema,
    reason: z.string().trim().min(4).max(1000),
  })
  .strict();
const canonical = (value: unknown) => canonicalize(JSON.parse(JSON.stringify(value)) as JsonValue);
const fail = (error: string) => ({ ok: false as const, error });
const activeRealSql =
  "NOT EXISTS(SELECT 1 FROM bid_sessions WHERE bid_year=? AND is_mock=0 AND current_phase<>'complete')";

async function updateSourceGuard(database: D1Database) {
  const control = await captureBidDefinitionControl(database, 2026);
  const generation = await database
    .prepare('SELECT revision FROM bid_reviewed_update_source_revision WHERE id=1')
    .first<{ revision: number }>();
  if (!control || !generation || !Number.isSafeInteger(generation.revision)) return null;
  return {
    token: bidContentHash(canonical([control.token, generation.revision])),
    sql: `(${control.sql}) AND EXISTS(SELECT 1 FROM bid_reviewed_update_source_revision WHERE id=1 AND revision=?)`,
    parameters: [...control.parameters, generation.revision],
  };
}

async function sourceImports(
  database: D1Database,
  version: {
    id: string;
    sha256: string;
    number: number;
    createdAt: number;
  },
) {
  const receipts = [
    {
      source: 'reviewed-2026-bid-definition',
      importId: version.id,
      revision: String(version.number),
      sha256: version.sha256,
      acceptedAt: new Date(version.createdAt).toISOString(),
    },
  ];
  const assignments = await database
    .prepare(`SELECT id,source_system AS sourceSystem,
    source_version AS sourceVersion,source_hash AS sourceHash,approved_at AS approvedAt
    FROM assignment_imports WHERE status='committed' AND approved_at IS NOT NULL ORDER BY id`)
    .all<{
      id: string;
      sourceSystem: string;
      sourceVersion: string;
      sourceHash: string;
      approvedAt: number;
    }>();
  for (const row of assignments.results)
    receipts.push({
      source: row.sourceSystem,
      importId: row.id,
      revision: row.sourceVersion,
      sha256: row.sourceHash,
      acceptedAt: new Date(row.approvedAt).toISOString(),
    });
  const rows = await database
    .prepare(`SELECT i.id AS importId,i.coverage_json AS coverageJson,
    r.row_number AS rowNumber,r.source_json AS sourceJson,r.applied_at AS appliedAt
    FROM targetsolutions_imports i JOIN targetsolutions_rows r ON r.import_id=i.id
    WHERE r.applied_at IS NOT NULL ORDER BY i.id,r.row_number`)
    .all<{
      importId: string;
      coverageJson: string;
      rowNumber: number;
      sourceJson: string;
      appliedAt: number;
    }>();
  const groups = new Map<string, typeof rows.results>();
  for (const row of rows.results)
    groups.set(row.importId, [...(groups.get(row.importId) ?? []), row]);
  for (const [importId, records] of groups) {
    const first = records[0];
    if (!first) continue;
    const receipt = JSON.parse(first.coverageJson)?.sourceReceipt;
    receipts.push({
      source: 'normally reviewed qualification import',
      importId,
      revision: receipt
        ? `${receipt.selected_sheet} (revision ${receipt.source_revision})`
        : 'reviewed-lifecycle-import',
      sha256:
        receipt?.workbook_hash ??
        bidContentHash(canonical(records.map((row) => [row.rowNumber, row.sourceJson]))),
      acceptedAt: new Date(Math.max(...records.map((row) => row.appliedAt))).toISOString(),
    });
  }
  return receipts;
}

async function prepareObservation(
  database: D1Database,
  writebackEnabled: 'true' | 'false' | undefined,
) {
  const capturedAt = Date.now();
  const before = await updateSourceGuard(database);
  const original = await loadBidEvidenceFreeze(getDb(database), 2026);
  if (!original) return fail('evidence_original_freeze_required');
  const head = await loadBidDefinitionHead(database, 2026);
  if (!head || !before) return fail('reviewed_2026_version_required');
  const version = await loadBidDefinitionVersion(database, 2026, head.versionId);
  if (
    !version.ok ||
    version.content.settings?.v !== 3 ||
    !version.content.settings.personnelEvaluationOn ||
    version.content.settings.evidenceCutoffAt !== APPROVED_2026_CUTOFF_AT
  )
    return fail('reviewed_2026_version_required');
  if (!version.content.settings.evidenceFreeze) return fail('evidence_original_freeze_required');
  const verified = await prepareBidDefinitionRun(database, {
    year: 2026,
    versionId: version.row.id,
    versionSha256: version.sha256,
    bidSessionId: `reviewed-update-preview-${ulid()}`,
    capturedAtMs: capturedAt,
    mode: 'mock',
  });
  if (!verified.ok) return fail('reviewed_2026_version_required');
  const sourceDecisions = withOctober1ReviewedSourceDecision(version.content.sourceDecisions);
  if (!sourceDecisions) return fail('evidence_update_latest_source_required');
  const evidence = await loadBidEvaluationEvidence(getDb(database), 2026);
  const imports = await database
    .prepare(`SELECT i.coverage_json AS coverageJson,COUNT(r.id) AS rowCount,
    COUNT(r.applied_at) AS reviewedCount FROM targetsolutions_imports i
    JOIN targetsolutions_rows r ON r.import_id=i.id GROUP BY i.id`)
    .all<{
      coverageJson: string;
      rowCount: number;
      reviewedCount: number;
    }>();
  const receipts = await sourceImports(database, {
    id: version.row.id,
    sha256: version.sha256,
    number: version.row.version_number,
    createdAt: version.row.created_at,
  });
  const blockers: string[] = [];
  const latest = latest2026ReviewedSourceUpdateIssue({
    versionNumber: version.row.version_number,
    sourceDecisions,
    members: evidence.memberRows,
    credentialImports: imports.results,
  });
  if (latest) blockers.push(latest);
  if (writebackEnabled !== 'false') blockers.push('evidence_update_writeback_enabled');
  const real = await database
    .prepare(`SELECT 1 AS active FROM bid_sessions
    WHERE bid_year=2026 AND is_mock=0 AND current_phase<>'complete' LIMIT 1`)
    .first();
  if (real) blockers.push('evidence_update_real_active');
  if (receipts.some((receipt) => Date.parse(receipt.acceptedAt) > capturedAt))
    blockers.push('evidence_update_source_after_capture');
  const holds = unresolvedQualificationHolds(
    evidence.qualificationHolds,
    evidence.qualificationEventRows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })),
    version.content.settings.credentialEvaluationOn,
  );
  const after = await updateSourceGuard(database);
  const current = await loadBidDefinitionHead(database, 2026);
  if (
    !after ||
    before.token !== after.token ||
    current?.versionId !== head.versionId ||
    current.revision !== head.revision
  )
    return fail('evidence_update_source_changed');
  const expected = {
    versionId: head.versionId,
    revision: head.revision,
    sha256: version.sha256,
    sourceToken: before.token,
    originalFreezeId: original.row.id,
  };
  const preview = {
    ok: true as const,
    ready: blockers.length === 0,
    blockers,
    expected,
    original: {
      freezeId: original.row.id,
      evaluationSha256: original.row.evaluation_sha256,
      personnelSha256: original.row.personnel_sha256,
      credentialSha256: original.row.credential_sha256,
    },
    eligibilityDates: {
      credentialEvaluationOn: version.content.settings.credentialEvaluationOn,
      personnelEvaluationOn: version.content.settings.personnelEvaluationOn,
    },
    counts: {
      members: evidence.memberRows.length,
      approvedQualificationEvents: evidence.qualificationEventRows.length,
      pendingQualificationHolds: holds.length,
    },
    sourceImports: receipts,
    capturedAt: new Date(capturedAt).toISOString(),
  };
  return {
    ok: true as const,
    preview,
    before,
    original,
    version,
    evidence,
    capturedAt,
    sourceDecisions,
  };
}

export async function previewReviewedBidEvidenceUpdate(
  database: D1Database,
  writebackEnabled: 'true' | 'false' | undefined,
) {
  try {
    const prepared = await prepareObservation(database, writebackEnabled);
    return prepared.ok ? prepared.preview : prepared;
  } catch {
    return fail('evidence_update_evaluation_failed');
  }
}

export async function captureReviewedBidEvidenceUpdate(
  database: D1Database,
  input: {
    key: string;
    actorSubject: string;
    actorId: number;
    request: z.infer<typeof ReviewedBidEvidenceUpdateRequestSchema>;
  },
  writebackEnabled: 'true' | 'false' | undefined,
) {
  const checked = ReviewedBidEvidenceUpdateRequestSchema.safeParse(input.request);
  if (
    !checked.success ||
    !input.key ||
    input.key !== input.key.trim() ||
    input.key.length > 200 ||
    !input.actorSubject ||
    !Number.isSafeInteger(input.actorId) ||
    input.actorId <= 0
  )
    return fail('invalid_evidence_update_request');
  const receiptInput = {
    key: input.key,
    actorSubject: input.actorSubject,
    operation: 'bid-evidence-reviewed-update',
    request: JSON.parse(canonical({ ...checked.data, actorId: input.actorId })),
  };
  const replay = async () => {
    const receipt = await loadConfigurationReceipt(database, receiptInput);
    if (!receipt || !receipt.ok) return receipt;
    const id = (receipt.response.update as { freezeId?: string })?.freezeId;
    const saved = id ? await loadReviewedBidEvidenceUpdate(getDb(database), 2026, id) : null;
    return saved
      ? { ok: true as const, replayed: true, response: saved.response }
      : fail('evidence_update_capture_failed');
  };
  const existing = await replay();
  if (existing) return existing;
  // Source-changed is a definitive no-write result. A matching receipt wins
  // even if a concurrent ordinary Save has since advanced the source. If the
  // rejected expected tuple is still current, retain an uncertain outcome.
  const sourceChanged = async () => {
    const recorded = await replay();
    if (recorded) return recorded;
    const control = await updateSourceGuard(database);
    const head = await loadBidDefinitionHead(database, 2026);
    return control &&
      head &&
      (control.token !== checked.data.expected.sourceToken ||
        head.versionId !== checked.data.expected.versionId ||
        head.revision !== checked.data.expected.revision)
      ? { ...fail('evidence_update_source_changed'), recorded: false as const }
      : fail('evidence_update_capture_failed');
  };
  const prepared = await prepareObservation(database, writebackEnabled);
  if (!prepared.ok)
    return prepared.error === 'evidence_update_source_changed' ? sourceChanged() : prepared;
  if (canonical(checked.data.expected) !== canonical(prepared.preview.expected))
    return sourceChanged();
  if (!prepared.preview.ready)
    return fail(prepared.preview.blockers[0] ?? 'evidence_update_evaluation_failed');
  const { version, evidence, capturedAt, original, before, sourceDecisions } = prepared;
  const configured = await loadExplicitBidPolicySource(
    getDb(database),
    {
      year: 2026,
      ruleBookVersion: version.row.rule_book_version,
      positionTemplateVersion: version.row.position_template_version,
      configJson: JSON.stringify(version.content.settings),
      configurationRevision: version.row.version_number,
      annualPolicyDocumentId: version.row.policy_document_id,
    },
    'mock',
  );
  if (!configured.ok) return fail('evidence_update_evaluation_failed');
  const material = await loadPersistedBidEvaluationMaterial(
    getDb(database),
    configured.policy,
    sourceDecisions,
  );
  // Only this explicitly reviewed observation evaluates the current approved
  // ledger. No generic run or original cutoff path ignores its frozen pin.
  const sourceSettings = version.content.settings;
  if (sourceSettings?.v !== 3) return fail('reviewed_2026_version_required');
  const { evidenceFreeze: _priorFreeze, ...settings } = sourceSettings;
  const evaluated = await prepareCapturedBidEvaluation(
    getDb(database),
    { ...material, settings },
    evidence,
    capturedAt,
    'mock',
  );
  if (!evaluated.ok)
    return { ...fail('evidence_update_evaluation_failed'), detail: evaluated.code };
  const compiled = compileBidDefinitionStagePolicy({
    pinnedEvaluation: evaluated.evaluation,
    content: { ...version.content, sourceDecisions },
  });
  if (!compiled.ok) return fail('evidence_update_evaluation_failed');
  const evaluation =
    'executionPolicy' in compiled
      ? { ...evaluated.evaluation, settings: { ...settings, livePolicy: compiled.executionPolicy } }
      : evaluated.evaluation;
  const hashes = evidenceFreezeDigests(evaluation);
  const sources = evidenceSourceDigests(evidence);
  // The original document shape remains byte-compatible. New observations
  // additionally seal pending holds, including reviewed but unverified rows.
  const credentialSourceJson = canonical({
    ...JSON.parse(sources.credentialSourceJson),
    qualificationHolds: evidence.qualificationHolds,
  });
  const credentialSha256 = bidContentHash(credentialSourceJson);
  const id = ulid();
  const provenance = ReviewedBidEvidenceUpdateSchema.parse({
    v: 1,
    kind: 'APPROVED_LEDGER_UPDATE',
    originalFreezeId: original.row.id,
    originalEvaluationSha256: original.row.evaluation_sha256,
    originalPersonnelSha256: original.row.personnel_sha256,
    originalCredentialSha256: original.row.credential_sha256,
    sourceToken: before.token,
    observedAsOfAt: new Date(capturedAt).toISOString(),
    reasonSha256: bidContentHash(checked.data.reason),
    sourceDecisionsSha256: bidContentHash(canonical(sourceDecisions)),
  });
  const row = {
    id,
    bid_year: 2026 as const,
    cutoff_at: APPROVED_2026_CUTOFF_AT as typeof APPROVED_2026_CUTOFF_AT,
    time_zone: 'America/New_York' as const,
    captured_at: capturedAt,
    actor_subject: input.actorSubject,
    source_version_id: version.row.id,
    source_version_sha256: version.sha256,
    source_token: before.token,
    evaluation_json: hashes.evaluationJson,
    personnel_source_json: sources.personnelSourceJson,
    credential_source_json: credentialSourceJson,
    evaluation_sha256: hashes.evaluationSha256,
    personnel_sha256: sources.personnelSha256,
    credential_sha256: credentialSha256,
    source_imports_json: canonical(prepared.preview.sourceImports),
  };
  const response = publicReviewedBidEvidenceUpdate({
    row,
    sourceImports: prepared.preview.sourceImports,
    reviewedUpdate: provenance,
    reason: checked.data.reason,
    sourceDecisions,
  });
  const stored = [
    encodeBidEvidenceDocument(row.evaluation_json),
    encodeBidEvidenceDocument(row.personnel_source_json),
    encodeBidEvidenceDocument(row.credential_source_json),
  ];
  const bytes = [
    ...stored,
    row.source_imports_json,
    canonical(provenance),
    checked.data.reason,
    input.actorSubject,
  ].reduce((total, value) => total + new TextEncoder().encode(value).length, 0);
  if (bytes > 1_900_000) return fail('evidence_update_storage_limit_exceeded');
  const after = await updateSourceGuard(database);
  if (!after || after.token !== before.token) return sourceChanged();
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO audit_log (id,bid_session_id,seq,actor_type,actor_id,action,target_kind,target_id,
        before_state,after_state,reason,ai_advisory_id,client_meta,created_at)
        SELECT ?,NULL,COALESCE(MAX(seq),0)+1,'admin',?,'bid_configuration_set','bid_evidence_reviewed_update',
        ?,?,?,?,NULL,?,? FROM audit_log WHERE bid_session_id IS NULL
        HAVING EXISTS(SELECT 1 FROM bid_definition_heads h JOIN bid_definition_versions v ON v.id=h.version_id
          WHERE h.bid_year=2026 AND h.version_id=? AND h.revision=? AND v.content_sha256=?)
          AND (${before.sql}) AND ${activeRealSql} AND ?='false'`)
        .bind(
          ulid(),
          input.actorId,
          id,
          canonical(prepared.preview.original),
          canonical(response),
          checked.data.reason,
          canonical({ operation: receiptInput.operation, idempotencyKey: input.key }),
          Math.floor(capturedAt / 1000),
          version.row.id,
          checked.data.expected.revision,
          version.sha256,
          ...before.parameters,
          2026,
          writebackEnabled ?? null,
        ),
      configurationReceiptStatement(database, receiptInput, response),
      database
        .prepare(`INSERT INTO bid_evidence_reviewed_updates
        (id,bid_year,kind,original_freeze_id,cutoff_at,time_zone,captured_at,actor_subject,reason,source_version_id,
          source_version_sha256,source_token,evaluation_json,personnel_source_json,credential_source_json,
          evaluation_sha256,personnel_sha256,credential_sha256,source_imports_json,provenance_json,idempotency_key)
        VALUES (?,2026,'APPROVED_LEDGER_UPDATE',?,?,'America/New_York',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(
          id,
          original.row.id,
          row.cutoff_at,
          capturedAt,
          input.actorSubject,
          checked.data.reason,
          version.row.id,
          version.sha256,
          before.token,
          ...stored,
          row.evaluation_sha256,
          row.personnel_sha256,
          row.credential_sha256,
          row.source_imports_json,
          canonical(provenance),
          input.key,
        ),
    ]);
  } catch {
    return sourceChanged();
  }
  // A successful transaction may exist even if its subsequent readback is
  // unavailable. Never label that outcome as a rejected source or clear its key.
  try {
    const saved = await loadReviewedBidEvidenceUpdate(getDb(database), 2026, id);
    return saved
      ? { ok: true as const, replayed: false, response: saved.response }
      : fail('evidence_update_capture_failed');
  } catch {
    return fail('evidence_update_capture_failed');
  }
}
