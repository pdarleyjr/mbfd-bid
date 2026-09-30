import { ulid } from 'ulid';
import { getDb } from '../db/index.js';
import { latest2026SourceCutoffIssue } from './2026-latest-source-cutoff.js';
import { bidContentHash } from './bid-definition-content.js';
import { prepareBidDefinitionRun } from './bid-definition-run.js';
import { loadBidDefinitionVersion } from './bid-definition-version.js';
import {
  APPROVED_2026_CUTOFF_AT,
  APPROVED_2026_CUTOFF_MS,
  evidenceFreezeDigests,
  evidenceSourceDigests,
  frozenEvaluationFromRun,
  loadBidEvidenceFreeze,
} from './bid-evidence-freeze.js';
import { encodeBidEvidenceDocument } from './bid-evidence-storage.js';
import { loadBidEvaluationEvidence } from './bid-policy.js';

/** A later capture is valid only when the immutable mutation log proves that
 * no relevant source write occurred after the cutoff. The database triggers
 * continue recording until the freeze is sealed. */

export async function capture2026BidEvidenceFreeze(database: D1Database, actorSubject: string) {
  const existing = await loadBidEvidenceFreeze(getDb(database), 2026);
  if (existing) return { ok: true as const, replayed: true, freeze: publicFreeze(existing) };
  const capturedAtMs = Date.now();
  if (capturedAtMs < APPROVED_2026_CUTOFF_MS)
    return { ok: false as const, error: 'evidence_cutoff_not_reached' };
  const head = await database
    .prepare(`SELECT v.id,v.content_sha256 AS sha256,v.version_number AS versionNumber,
    v.created_at AS createdAt FROM bid_definition_heads h JOIN bid_definition_versions v ON v.id=h.version_id
    WHERE h.bid_year=2026`)
    .first<{
      id: string;
      sha256: string;
      versionNumber: number;
      createdAt: number;
    }>();
  if (!head || head.versionNumber <= 8)
    return { ok: false as const, error: 'reviewed_2026_version_required' };
  const version = await loadBidDefinitionVersion(database, 2026, head.id);
  if (
    !version.ok ||
    version.sha256 !== head.sha256 ||
    version.content.settings?.v !== 3 ||
    version.content.settings.evidenceCutoffAt !== APPROVED_2026_CUTOFF_AT ||
    version.content.settings.evidenceFreeze
  )
    return { ok: false as const, error: 'reviewed_2026_version_invalid' };
  const run = await prepareBidDefinitionRun(database, {
    year: 2026,
    versionId: head.id,
    versionSha256: head.sha256,
    bidSessionId: `cutoff-evidence-${ulid()}`,
    capturedAtMs,
    mode: 'mock',
  });
  if (!run.ok)
    return { ok: false as const, error: 'evidence_cutoff_evaluation_failed', detail: run.code };
  const evaluation = frozenEvaluationFromRun(run.snapshot);
  const rawEvidence = await loadBidEvaluationEvidence(getDb(database), 2026);
  const reviewedCredentialImports = await database
    .prepare(`SELECT i.coverage_json AS coverageJson,COUNT(r.id) AS rowCount,
      COUNT(r.applied_at) AS reviewedCount FROM targetsolutions_imports i
      JOIN targetsolutions_rows r ON r.import_id=i.id GROUP BY i.id`)
    .all<{ coverageJson: string; rowCount: number; reviewedCount: number }>();
  const latestSourceIssue = latest2026SourceCutoffIssue({
    versionNumber: head.versionNumber,
    sourceDecisions: version.content.sourceDecisions,
    members: rawEvidence.memberRows,
    credentialImports: reviewedCredentialImports.results,
  });
  if (latestSourceIssue) return { ok: false as const, error: latestSourceIssue };
  const baseline = evaluation.staffingBaseline;
  if (!baseline) return { ok: false as const, error: 'authoritative_staffing_baseline_required' };
  const sourceImports = [
    {
      source: 'reviewed-2026-bid-definition',
      importId: head.id,
      revision: String(head.versionNumber),
      sha256: head.sha256,
      acceptedAt: new Date(head.createdAt).toISOString(),
    },
    {
      source: 'accepted-authoritative-staffing-baseline',
      importId: baseline.importId,
      revision: baseline.baselineAcceptanceId,
      sha256: baseline.sourceHash,
      acceptedAt: new Date(baseline.acceptedAtMs).toISOString(),
    },
  ];
  const assignmentImports = await database
    .prepare(`SELECT id,source_system AS sourceSystem,
    source_version AS sourceVersion,source_hash AS sourceHash,approved_at AS approvedAt
    FROM assignment_imports WHERE status='committed' AND approved_at IS NOT NULL
    ORDER BY id`)
    .all<{
      id: string;
      sourceSystem: string;
      sourceVersion: string;
      sourceHash: string;
      approvedAt: number;
    }>();
  for (const row of assignmentImports.results) {
    if (row.id === baseline.importId) continue;
    sourceImports.push({
      source: row.sourceSystem,
      importId: row.id,
      revision: row.sourceVersion,
      sha256: row.sourceHash,
      acceptedAt: new Date(row.approvedAt).toISOString(),
    });
  }
  const credentialRows = await database
    .prepare(`SELECT i.id AS importId,i.created_at AS createdAt,
    i.coverage_json AS coverageJson,i.filename AS filename,
    r.row_number AS rowNumber,r.source_json AS sourceJson,r.applied_at AS appliedAt
    FROM targetsolutions_imports i JOIN targetsolutions_rows r ON r.import_id=i.id
    WHERE r.applied_at IS NOT NULL ORDER BY i.id,r.row_number`)
    .all<{
      importId: string;
      createdAt: number;
      coverageJson: string;
      filename: string;
      rowNumber: number;
      sourceJson: string;
      appliedAt: number;
    }>();
  const credentialImports = new Map<string, typeof credentialRows.results>();
  for (const row of credentialRows.results)
    credentialImports.set(row.importId, [...(credentialImports.get(row.importId) ?? []), row]);
  for (const [importId, rows] of credentialImports) {
    const first = rows[0];
    if (!first) continue;
    const createdAt = first.createdAt;
    const receipt = JSON.parse(first.coverageJson).sourceReceipt as
      | {
          workbook_hash: string;
          selected_sheet: string;
          source_revision: number;
        }
      | undefined;
    sourceImports.push({
      source: receipt
        ? `Approved credential workbook: ${first.filename}`
        : 'TargetSolutions applied qualification import',
      importId,
      revision: receipt
        ? `${receipt.selected_sheet} (revision ${receipt.source_revision})`
        : `upload-${createdAt}`,
      sha256:
        receipt?.workbook_hash ??
        bidContentHash(JSON.stringify(rows.map((row) => [row.rowNumber, row.sourceJson]))),
      acceptedAt: new Date(Math.max(...rows.map((row) => row.appliedAt))).toISOString(),
    });
  }
  if (sourceImports.some((source) => Date.parse(source.acceptedAt) > APPROVED_2026_CUTOFF_MS))
    return { ok: false as const, error: 'evidence_source_after_cutoff' };
  const hashes = evidenceFreezeDigests(evaluation);
  const sourceHashes = evidenceSourceDigests(rawEvidence);
  const id = ulid();
  const sql = `INSERT INTO bid_evidence_freezes
    (id,bid_year,cutoff_at,time_zone,captured_at,actor_subject,source_version_id,
     source_version_sha256,source_token,evaluation_json,personnel_source_json,
     credential_source_json,evaluation_sha256,
     personnel_sha256,credential_sha256,source_imports_json)
    SELECT ?,2026,?,'America/New_York',?,?,?,?,?,?,?,?,?,?,?,?
    WHERE EXISTS(SELECT 1 FROM bid_definition_heads h JOIN bid_definition_versions v ON v.id=h.version_id
      WHERE h.bid_year=2026 AND h.version_id=? AND v.content_sha256=?)
      AND NOT EXISTS(SELECT 1 FROM bid_cutoff_mutations WHERE occurred_at>=1790802000000)
      AND ${run.sourceGuard.sql}`;
  try {
    const evaluationDocument = encodeBidEvidenceDocument(hashes.evaluationJson);
    const personnelDocument = encodeBidEvidenceDocument(sourceHashes.personnelSourceJson);
    const credentialDocument = encodeBidEvidenceDocument(sourceHashes.credentialSourceJson);
    const importsJson = JSON.stringify(sourceImports);
    // Reserve space for the scalar metadata and SQLite record header as well
    // as the three compressed documents. A larger future capture fails closed.
    const storedBytes = [
      evaluationDocument,
      personnelDocument,
      credentialDocument,
      importsJson,
      actorSubject,
    ].reduce((total, value) => total + new TextEncoder().encode(value).length, 0);
    if (storedBytes > 1_900_000)
      return { ok: false as const, error: 'evidence_cutoff_storage_limit_exceeded' };
    await database
      .prepare(sql)
      .bind(
        id,
        APPROVED_2026_CUTOFF_AT,
        capturedAtMs,
        actorSubject,
        head.id,
        head.sha256,
        run.sourceGuard.token,
        evaluationDocument,
        personnelDocument,
        credentialDocument,
        hashes.evaluationSha256,
        sourceHashes.personnelSha256,
        sourceHashes.credentialSha256,
        importsJson,
        head.id,
        head.sha256,
        ...run.sourceGuard.parameters,
      )
      .run();
  } catch {
    const afterFailure = await loadBidEvidenceFreeze(getDb(database), 2026);
    if (afterFailure)
      return { ok: true as const, replayed: true, freeze: publicFreeze(afterFailure) };
    return { ok: false as const, error: 'evidence_cutoff_capture_failed' };
  }
  const saved = await loadBidEvidenceFreeze(getDb(database), 2026);
  if (!saved || saved.row.id !== id || saved.row.evaluation_sha256 !== hashes.evaluationSha256) {
    const mutations = await database
      .prepare('SELECT COUNT(*) AS count FROM bid_cutoff_mutations WHERE occurred_at>=?')
      .bind(APPROVED_2026_CUTOFF_MS)
      .first<{ count: number }>();
    return {
      ok: false as const,
      error:
        mutations && mutations.count > 0
          ? 'evidence_post_cutoff_mutation_detected'
          : 'evidence_cutoff_capture_failed',
    };
  }
  return { ok: true as const, replayed: false, freeze: publicFreeze(saved) };
}

function publicFreeze(saved: NonNullable<Awaited<ReturnType<typeof loadBidEvidenceFreeze>>>) {
  const { row, sourceImports } = saved;
  return {
    freezeId: row.id,
    evidenceCutoffAt: row.cutoff_at,
    timeZone: row.time_zone,
    capturedAt: new Date(row.captured_at).toISOString(),
    sourceVersionId: row.source_version_id,
    sourceVersionSha256: row.source_version_sha256,
    evaluationSha256: row.evaluation_sha256,
    personnelSha256: row.personnel_sha256,
    credentialSha256: row.credential_sha256,
    sourceImports,
  };
}

export async function read2026BidEvidenceFreeze(database: D1Database) {
  const saved = await loadBidEvidenceFreeze(getDb(database), 2026);
  return saved ? publicFreeze(saved) : null;
}
