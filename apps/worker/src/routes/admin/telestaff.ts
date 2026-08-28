import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';

import { getDb } from '../../db/index.js';
import { evaluateTeleStaffImportCompleteness } from '../../lib/authoritative-staffing-baseline.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

type ImportStatus = 'staged' | 'reviewed' | 'approved' | 'committed' | 'rejected';

interface ImportDbRow {
  id: string;
  source_system: string;
  source_format: string | null;
  parser_version: string | null;
  source_kind: 'official' | 'synthetic_test' | 'legacy_unclassified';
  status: ImportStatus;
  input_row_count: number;
  normalized_data_row_count: number | null;
  unique_employee_count: number | null;
  report_row_count: number;
  structural_row_count: number;
  source_snapshot_as_of: string | null;
  reconciliation_revision: number;
  created_at: number;
  approved_at: number | null;
  committed_at: number | null;
  source_row_count: number;
  pending_source_row_count: number;
  hard_blocker_source_row_count: number;
  incomplete_topology_source_row_count: number;
  missing_observation_finding_count: number;
  pending_missing_observation_finding_count: number;
}

interface ImportRowDbRow {
  id: string;
  source_row_number: number;
  has_source_a_r_day: number;
  disposition: string;
  reconciliation_classification: string | null;
  review_status: string;
  resolution_action: string | null;
  source_topology_completeness: 'complete' | 'incomplete';
  has_resolved_member: number;
  has_staffing_position_source_mapping: number;
}

interface MissingObservationDbRow {
  id: string;
  classification: 'MISSING_OBSERVATION';
  review_status: 'pending' | 'resolved';
  resolution_action: 'RETAIN_ASSIGNMENT' | 'END_ASSIGNMENT' | null;
  reviewed_at: number | null;
  has_assignment_context: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

const IMPORT_SUMMARY_SELECT = `
  SELECT
    import_record.id,
    import_record.source_system,
    import_record.source_format,
    import_record.parser_version,
    import_record.source_kind,
    import_record.status,
    import_record.input_row_count,
    import_record.normalized_data_row_count,
    import_record.unique_employee_count,
    import_record.report_row_count,
    import_record.structural_row_count,
    import_record.source_snapshot_as_of,
    import_record.reconciliation_revision,
    import_record.created_at,
    import_record.approved_at,
    import_record.committed_at,
    (
      SELECT COUNT(*)
      FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id
    ) AS source_row_count,
    (
      SELECT COUNT(*)
      FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id
        AND source_row.review_status = 'pending'
    ) AS pending_source_row_count,
    (
      SELECT COUNT(*)
      FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id
         AND (
          (
            source_row.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
            AND source_row.review_status <> 'rejected'
          )
          OR (
            source_row.reconciliation_classification IS NULL
            AND source_row.disposition IN ('unknown_employee', 'ambiguous_mapping')
          )
        )
    ) AS hard_blocker_source_row_count,
    (
      SELECT COUNT(*)
      FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id
        AND source_row.source_topology_completeness = 'incomplete'
    ) AS incomplete_topology_source_row_count,
    (
      SELECT COUNT(*)
      FROM assignment_import_missing_observations finding
      WHERE finding.import_id = import_record.id
    ) AS missing_observation_finding_count,
    (
      SELECT COUNT(*)
      FROM assignment_import_missing_observations finding
      WHERE finding.import_id = import_record.id
        AND finding.review_status = 'pending'
    ) AS pending_missing_observation_finding_count
  FROM assignment_imports import_record`;

/**
 * This surface intentionally stops at inspecting sanitized reconciliation
 * metadata. The versioned HTML adapter may validate an already-authorized
 * in-memory source, but this route cannot upload, stage, apply, contact
 * TeleStaff, or write an audit record.
 */
const READINESS = {
  readOnly: true,
  parse: {
    adapterAvailable: true,
    supportedSourceFormats: ['TELSTAFF_ASSIGNMENTS_HTML_V1'],
    ingestionAvailable: false,
    blocker: 'READ_ONLY_INGESTION_NOT_IMPLEMENTED',
    reason:
      'A versioned HTML adapter is available for approved local validation; this read-only route cannot upload or persist a source artifact.',
  },
  apply: {
    ready: false,
    blocker: 'AUTHORITATIVE_STAFFING_BASELINE_REQUIRED',
    reason:
      'Applying reconciliation remains unavailable until an authoritative staffing baseline exists.',
  },
  externalSourceAccess: false,
  auditWrites: false,
} as const;

function parsePositivePageSize(value: string | undefined): { value?: number; error?: string } {
  if (value === undefined) return { value: DEFAULT_PAGE_SIZE };
  if (!/^[1-9]\d*$/.test(value)) return { error: 'invalid_limit' };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_PAGE_SIZE) return { error: 'invalid_limit' };
  return { value: parsed };
}

function parseOffset(value: string | undefined): { value?: number; error?: string } {
  if (value === undefined) return { value: 0 };
  if (!/^(0|[1-9]\d*)$/.test(value)) return { error: 'invalid_offset' };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return { error: 'invalid_offset' };
  return { value: parsed };
}

function mapImport(row: ImportDbRow) {
  return {
    id: row.id,
    sourceSystem: row.source_system,
    sourceFormat: row.source_format,
    parserVersion: row.parser_version,
    sourceKind: row.source_kind,
    status: row.status,
    inputRowCount: row.input_row_count,
    normalizedDataRowCount: row.normalized_data_row_count,
    uniqueEmployeeCount: row.unique_employee_count,
    reportRowCount: row.report_row_count,
    structuralRowCount: row.structural_row_count,
    sourceSnapshotAsOf: row.source_snapshot_as_of,
    reconciliationRevision: row.reconciliation_revision,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    committedAt: row.committed_at,
    reconciliation: {
      sourceRows: row.source_row_count,
      pendingSourceRows: row.pending_source_row_count,
      hardBlockerSourceRows: row.hard_blocker_source_row_count,
      incompleteTopologySourceRows: row.incomplete_topology_source_row_count,
      missingObservationFindings: row.missing_observation_finding_count,
      pendingMissingObservationFindings: row.pending_missing_observation_finding_count,
    },
  };
}

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

/**
 * GET /api/admin/telestaff/imports
 *
 * Lists only sanitized import-level reconciliation history. In particular, it
 * omits source hashes, row fingerprints, member reference HMACs, member IDs,
 * reviewer IDs, and free-text review reasons.
 */
router.get('/imports', async (c) => {
  const parsedLimit = parsePositivePageSize(c.req.query('limit'));
  if (parsedLimit.error) return c.json({ error: parsedLimit.error }, 400);

  const result = await c.env.DB.prepare(
    `${IMPORT_SUMMARY_SELECT}
     ORDER BY import_record.created_at DESC, import_record.id DESC
     LIMIT ?`,
  )
    .bind(parsedLimit.value)
    .all();
  const imports = (result.results as unknown as ImportDbRow[]).map(mapImport);

  return c.json({ imports, readiness: READINESS });
});

/**
 * GET /api/admin/telestaff/imports/:importId
 *
 * Shows a bounded, sanitized reconciliation detail. Source-row identifiers
 * identify only import evidence; no personnel identifier or raw source value
 * leaves this endpoint.
 */
router.get('/imports/:importId', async (c) => {
  const importId = c.req.param('importId');
  if (importId.length === 0 || importId.length > 128 || importId !== importId.trim()) {
    return c.json({ error: 'invalid_import_id' }, 400);
  }

  const parsedLimit = parsePositivePageSize(c.req.query('limit'));
  if (parsedLimit.error) return c.json({ error: parsedLimit.error }, 400);
  const parsedOffset = parseOffset(c.req.query('offset'));
  if (parsedOffset.error) return c.json({ error: parsedOffset.error }, 400);

  const importResult = await c.env.DB.prepare(
    `${IMPORT_SUMMARY_SELECT}
     WHERE import_record.id = ?`,
  )
    .bind(importId)
    .all();
  const importRow = (importResult.results as unknown as ImportDbRow[])[0];
  if (!importRow) return c.json({ error: 'not_found' }, 404);

  const [rowsResult, rowCountResult, missingFindingsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         id,
         source_row_number,
         CASE WHEN source_a_r_day IS NULL THEN 0 ELSE 1 END AS has_source_a_r_day,
         disposition,
         reconciliation_classification,
         review_status,
         resolution_action,
         source_topology_completeness,
         CASE WHEN resolved_member_id IS NULL THEN 0 ELSE 1 END AS has_resolved_member,
         CASE WHEN staffing_position_source_mapping_id IS NULL THEN 0 ELSE 1 END
           AS has_staffing_position_source_mapping
       FROM assignment_import_rows
       WHERE import_id = ?
       ORDER BY source_row_number ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(importId, parsedLimit.value, parsedOffset.value)
      .all(),
    c.env.DB.prepare(
      'SELECT COUNT(*) AS total_rows FROM assignment_import_rows WHERE import_id = ?',
    )
      .bind(importId)
      .all(),
    c.env.DB.prepare(
      `SELECT
         id,
         classification,
         review_status,
         resolution_action,
         reviewed_at,
         CASE WHEN member_assignment_id IS NULL THEN 0 ELSE 1 END AS has_assignment_context
       FROM assignment_import_missing_observations
       WHERE import_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
      .bind(importId)
      .all(),
  ]);

  const rows = (rowsResult.results as unknown as ImportRowDbRow[]).map((row) => ({
    id: row.id,
    sourceRowNumber: row.source_row_number,
    hasSourceARDay: row.has_source_a_r_day === 1,
    disposition: row.disposition,
    reconciliationClassification: row.reconciliation_classification,
    reviewStatus: row.review_status,
    resolutionAction: row.resolution_action,
    sourceTopologyCompleteness: row.source_topology_completeness,
    hasResolvedMember: row.has_resolved_member === 1,
    hasStaffingPositionSourceMapping: row.has_staffing_position_source_mapping === 1,
  }));
  const missingObservationFindings = (
    missingFindingsResult.results as unknown as MissingObservationDbRow[]
  ).map((finding) => ({
    id: finding.id,
    classification: finding.classification,
    reviewStatus: finding.review_status,
    resolutionAction: finding.resolution_action,
    reviewedAt: finding.reviewed_at,
    hasAssignmentContext: finding.has_assignment_context === 1,
  }));
  const totalRows = (rowCountResult.results as unknown as Array<{ total_rows: number }>)[0]
    ?.total_rows;

  return c.json({
    import: mapImport(importRow),
    rows,
    missingObservationFindings,
    sourceValidation: await evaluateTeleStaffImportCompleteness(getDb(c.env.DB), importId),
    pagination: {
      limit: parsedLimit.value,
      offset: parsedOffset.value,
      totalRows: totalRows ?? 0,
    },
    readiness: READINESS,
  });
});

export default router;
