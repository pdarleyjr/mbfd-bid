import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import { getDb } from '../../db/index.js';
import { acceptAuthoritativeStaffingBaseline } from '../../lib/authoritative-staffing-baseline-acceptance.js';
import { evaluateTeleStaffImportCompleteness } from '../../lib/authoritative-staffing-baseline.js';
import { createCsvStream } from '../../lib/csv-stream.js';
import { parseTeleStaffAssignmentsHtml } from '../../lib/telestaff-assignment-html.js';
import {
  type TeleStaffSourceKind,
  stageParsedTeleStaffAssignmentsHtml,
} from '../../lib/telestaff-assignment-import.js';
import {
  type TeleStaffSourceObservationTime,
  allowedReviewActionsFor,
  createTeleStaffOperatorPreview,
  hasUsableTeleStaffHmacKey,
  isCalendarDate,
  makeTeleStaffHmacFunctions,
  reconcileStagedTeleStaffImport,
  reviewMutationFor,
  reviewStateFor,
  validateTeleStaffSourceObservationTime,
} from '../../lib/telestaff-operator-workflow.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
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
  source_observed_at: number | null;
  source_observation_time_basis: 'date_only' | 'source_metadata' | 'administrator_confirmed';
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
  is_current_record_newer: number;
}

interface MissingObservationDbRow {
  id: string;
  classification: 'MISSING_OBSERVATION';
  review_status: 'pending' | 'resolved';
  resolution_action: 'RETAIN_ASSIGNMENT' | 'END_ASSIGNMENT' | null;
  reviewed_at: number | null;
  has_assignment_context: number;
}

interface ApplyDbRow {
  id: string;
  row_fingerprint: string;
  source_a_r_day: string | null;
  normalized_source_topology: string;
  source_topology_completeness: 'complete' | 'incomplete';
  reconciliation_classification: string | null;
  review_status: string;
  resolution_action: string | null;
  resolved_member_id: number | null;
  staffing_position_source_mapping_id: string | null;
  staffing_position_id: string | null;
  member_employment_status: 'unknown' | 'active' | 'inactive' | 'retired' | 'separated' | null;
  member_rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF' | null;
  mapping_is_approved_for_snapshot: number;
}

interface ActiveAssignmentDbRow {
  id: string;
  member_id: number;
  staffing_position_id: string;
  origin_type: string;
  status: 'planned' | 'active' | 'superseded' | 'cancelled' | 'ended';
  effective_from: string;
  effective_to: string | null;
}

interface EndAssignmentDbRow extends ActiveAssignmentDbRow {
  sourceRowId: string;
}

interface TeleStaffLifecycleEvidence {
  assignmentId: string;
  eventId: string;
  sourceRowId: string;
  memberId: number;
  staffingPositionId: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
}

interface SqlGuard {
  sql: string;
  bindings: unknown[];
}

interface ReconciliationExportSourceRowDbRow {
  source_row_number: number;
  has_source_a_r_day: number;
  reconciliation_classification: string | null;
  review_status: string;
  resolution_action: string | null;
  source_topology_completeness: 'complete' | 'incomplete';
  has_resolved_member: number;
  has_staffing_position_source_mapping: number;
  is_current_record_newer: number;
}

interface ReconciliationExportMissingFindingDbRow {
  classification: string;
  review_status: string;
  resolution_action: string | null;
  has_assignment_context: number;
}

interface ReconciliationExportRow {
  recordType: 'import_summary' | 'source_row' | 'missing_observation_finding';
  importStatus: string | null;
  sourceKind: string | null;
  sourceSnapshotAsOf: string | null;
  sourceObservedAt: string | null;
  sourceObservationTimeBasis: string | null;
  reconciliationRevision: number | null;
  inputRowCount: number | null;
  normalizedDataRowCount: number | null;
  uniqueEmployeeCount: number | null;
  reportRowCount: number | null;
  structuralRowCount: number | null;
  sourceRowCount: number | null;
  pendingSourceRowCount: number | null;
  hardBlockerSourceRowCount: number | null;
  incompleteTopologySourceRowCount: number | null;
  missingObservationFindingCount: number | null;
  pendingMissingObservationFindingCount: number | null;
  importCreatedAt: string | null;
  approvedAt: string | null;
  committedAt: string | null;
  exportedAt: string | null;
  sourceRowNumber: number | null;
  reconciliationClassification: string | null;
  reviewStatus: string | null;
  resolutionAction: string | null;
  sourceTopologyCompleteness: string | null;
  hasSourceARDay: boolean | null;
  hasResolvedMember: boolean | null;
  hasStaffingPositionSourceMapping: boolean | null;
  isCurrentRecordNewer: boolean | null;
  reviewState: string | null;
  allowedReviewActions: string | null;
  hasAssignmentContext: boolean | null;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_RECONCILIATION_EXPORT_RECORDS = 10_000;

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
    import_record.source_observed_at,
    import_record.source_observation_time_basis,
    import_record.reconciliation_revision,
    import_record.created_at,
    import_record.approved_at,
    import_record.committed_at,
    (
      SELECT COUNT(*) FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id
    ) AS source_row_count,
    (
      SELECT COUNT(*) FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id AND source_row.review_status = 'pending'
    ) AS pending_source_row_count,
    (
      SELECT COUNT(*) FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id
        AND (
          (source_row.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
            AND source_row.review_status <> 'rejected')
          OR (source_row.reconciliation_classification IS NULL
            AND source_row.disposition IN ('unknown_employee', 'ambiguous_mapping'))
        )
    ) AS hard_blocker_source_row_count,
    (
      SELECT COUNT(*) FROM assignment_import_rows source_row
      WHERE source_row.import_id = import_record.id
        AND source_row.source_topology_completeness = 'incomplete'
    ) AS incomplete_topology_source_row_count,
    (
      SELECT COUNT(*) FROM assignment_import_missing_observations finding
      WHERE finding.import_id = import_record.id
    ) AS missing_observation_finding_count,
    (
      SELECT COUNT(*) FROM assignment_import_missing_observations finding
      WHERE finding.import_id = import_record.id AND finding.review_status = 'pending'
    ) AS pending_missing_observation_finding_count
  FROM assignment_imports import_record`;

/** Manual-only, no raw-source-persistence workflow contract. */
const READINESS = {
  readOnly: false,
  manualUploadAvailable: true,
  rawSourcePersistence: false,
  sourceSnapshotRequired: true,
  externalSourceAccess: false,
  preapprovedCanonicalMappingsOnly: true,
  syntheticCanonicalWrites: false,
  apply: {
    ready: 'per_import',
    blockers: [
      'OFFICIAL_SOURCE_REQUIRED',
      'EXPLICIT_CANONICAL_EFFECTIVE_DATE_REQUIRED',
      'TERMINAL_RECONCILIATION_REQUIRED',
      'CURRENT_CANONICAL_STATE_MUST_MATCH_REVIEW',
    ],
  },
} as const;

const ReviewRequestSchema = z
  .object({
    expected_reconciliation_revision: z.number().int().nonnegative(),
    decision: z.enum([
      'accept_observation',
      'keep_current',
      'defer_new_position',
      'reject_source_row',
      'retain_incomplete_source_row',
    ]),
  })
  .strict();

const BaselineAcceptanceRequestSchema = z
  .object({
    bid_year: z.number().int().min(2000).max(9999),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

const StaffingCertificationRequestSchema = z
  .object({
    expected_reconciliation_revision: z.number().int().nonnegative(),
    reason: z.string().trim().min(12).max(500),
  })
  .strict();

const SafeExceptionResolutionRequestSchema = z
  .object({
    expected_reconciliation_revision: z.number().int().nonnegative(),
    reason: z.string().trim().min(12).max(500),
  })
  .strict();

const DeterministicReviewRequestSchema = SafeExceptionResolutionRequestSchema;

const ReconcileRequestSchema = z
  .object({
    expected_reconciliation_revision: z.number().int().nonnegative(),
  })
  .strict();

const ApplyRequestSchema = z
  .object({
    expected_reconciliation_revision: z.number().int().nonnegative(),
    canonical_effective_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

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

function isOpaqueId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value === value.trim();
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
    sourceObservedAt: row.source_observed_at,
    sourceObservationTimeBasis: row.source_observation_time_basis,
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

function safeExportCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return /^[A-Za-z0-9_]{1,120}$/.test(value) ? value : 'UNAVAILABLE';
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeExportTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function safeExportCalendarDate(value: string | null): string | null {
  return value !== null && isCalendarDate(value) ? value : null;
}

function reconciliationExportRow(
  recordType: ReconciliationExportRow['recordType'],
  values: Partial<Omit<ReconciliationExportRow, 'recordType'>> = {},
): ReconciliationExportRow {
  return {
    recordType,
    importStatus: null,
    sourceKind: null,
    sourceSnapshotAsOf: null,
    sourceObservedAt: null,
    sourceObservationTimeBasis: null,
    reconciliationRevision: null,
    inputRowCount: null,
    normalizedDataRowCount: null,
    uniqueEmployeeCount: null,
    reportRowCount: null,
    structuralRowCount: null,
    sourceRowCount: null,
    pendingSourceRowCount: null,
    hardBlockerSourceRowCount: null,
    incompleteTopologySourceRowCount: null,
    missingObservationFindingCount: null,
    pendingMissingObservationFindingCount: null,
    importCreatedAt: null,
    approvedAt: null,
    committedAt: null,
    exportedAt: null,
    sourceRowNumber: null,
    reconciliationClassification: null,
    reviewStatus: null,
    resolutionAction: null,
    sourceTopologyCompleteness: null,
    hasSourceARDay: null,
    hasResolvedMember: null,
    hasStaffingPositionSourceMapping: null,
    isCurrentRecordNewer: null,
    reviewState: null,
    allowedReviewActions: null,
    hasAssignmentContext: null,
    ...values,
  };
}

async function loadImportSummary(
  d1: D1Database,
  importId: string,
): Promise<ImportDbRow | undefined> {
  const result = await d1
    .prepare(`${IMPORT_SUMMARY_SELECT} WHERE import_record.id = ?`)
    .bind(importId)
    .all();
  return (result.results as unknown as ImportDbRow[])[0];
}

async function readUploadForm(c: { req: { formData: () => Promise<FormData> } }): Promise<
  | ({
      ok: true;
      source: Uint8Array;
      sourceSnapshotAsOf: string;
      sourceKind: TeleStaffSourceKind;
    } & TeleStaffSourceObservationTime)
  | { ok: false; error: string }
> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return { ok: false, error: 'invalid_upload' };
  }
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'file_required' };
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES)
    return { ok: false, error: 'invalid_file_size' };
  const sourceSnapshot = form.get('source_snapshot_as_of');
  if (typeof sourceSnapshot !== 'string' || !isCalendarDate(sourceSnapshot)) {
    return { ok: false, error: 'invalid_source_snapshot_as_of' };
  }
  const sourceKindInput = form.get('source_kind');
  if (sourceKindInput !== 'official' && sourceKindInput !== 'synthetic_test') {
    return { ok: false, error: 'invalid_source_kind' };
  }
  const sourceObservedAtInput = form.get('source_observed_at');
  const sourceObservationTimeBasisInput = form.get('source_observation_time_basis');
  if (
    (sourceObservedAtInput !== null && typeof sourceObservedAtInput !== 'string') ||
    (sourceObservationTimeBasisInput !== null &&
      typeof sourceObservationTimeBasisInput !== 'string')
  ) {
    return { ok: false, error: 'invalid_source_observation_time' };
  }
  const sourceObservationTime = validateTeleStaffSourceObservationTime({
    sourceSnapshotAsOf: sourceSnapshot,
    sourceObservedAt: sourceObservedAtInput,
    sourceObservationTimeBasis: sourceObservationTimeBasisInput,
  });
  if (!sourceObservationTime.ok)
    return { ok: false, error: sourceObservationTime.code.toLowerCase() };
  return {
    ok: true,
    source: new Uint8Array(await file.arrayBuffer()),
    sourceSnapshotAsOf: sourceSnapshot,
    sourceKind: sourceKindInput,
    sourceObservedAt: sourceObservationTime.sourceObservedAt,
    sourceObservationTimeBasis: sourceObservationTime.sourceObservationTimeBasis,
  };
}

function actorMemberId(claims: JwtPayload): number | null {
  return Number.isSafeInteger(claims.member_id) && claims.member_id > 0 ? claims.member_id : null;
}

function previousCalendarDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function activeOn(assignment: ActiveAssignmentDbRow, date: string): boolean {
  return (
    assignment.effective_from <= date &&
    (assignment.effective_to === null || assignment.effective_to >= date)
  );
}

function terminalApplyRows(rows: readonly ApplyDbRow[]): ApplyDbRow[] | null {
  const materialized: ApplyDbRow[] = [];
  for (const row of rows) {
    // Reconciliation is a snapshot, not a perpetual authorization grant.
    // Recheck the exact reviewed locator against an approved, active canonical
    // slot before the import can transition or materialize any observation.
    if (
      row.staffing_position_source_mapping_id !== null &&
      row.mapping_is_approved_for_snapshot !== 1
    ) {
      return null;
    }
    switch (row.reconciliation_classification) {
      case 'UNCHANGED':
        if (
          row.review_status !== 'not_required' ||
          row.resolved_member_id === null ||
          row.staffing_position_source_mapping_id === null
        ) {
          return null;
        }
        break;
      case 'MOVED':
      case 'NEW_ASSIGNMENT':
        if (row.review_status === 'approved' && row.resolution_action === 'APPLY_OBSERVATION') {
          if (
            row.resolved_member_id === null ||
            row.staffing_position_source_mapping_id === null ||
            row.staffing_position_id === null
          ) {
            return null;
          }
          materialized.push(row);
        } else if (
          row.review_status !== 'rejected' ||
          row.resolution_action !== 'REJECT_SOURCE_ROW'
        ) {
          return null;
        }
        break;
      case 'NEW_POSITION':
        if (
          !(
            (row.review_status === 'approved' && row.resolution_action === 'DEFER_NEW_POSITION') ||
            (row.review_status === 'rejected' && row.resolution_action === 'REJECT_SOURCE_ROW')
          )
        ) {
          return null;
        }
        break;
      case 'INCOMPLETE_TOPOLOGY':
        if (
          !(
            (row.review_status === 'approved' &&
              row.resolution_action === 'RETAIN_UNMATERIALIZED_SOURCE_ROW') ||
            (row.review_status === 'rejected' && row.resolution_action === 'REJECT_SOURCE_ROW')
          )
        ) {
          return null;
        }
        break;
      case 'UNKNOWN_EMPLOYEE':
      case 'AMBIGUOUS_MAPPING':
        if (row.review_status !== 'rejected' || row.resolution_action !== 'REJECT_SOURCE_ROW') {
          return null;
        }
        break;
      default:
        return null;
    }
  }
  return materialized;
}

/**
 * Binds the reviewed source snapshot and the canonical effective-range view to
 * the same D1 batch that commits it. Revision alone is insufficient because
 * source identity/mapping fields are immutable evidence but do not all advance
 * the reconciliation review token.
 */
export function teleStaffApplyGuards(input: {
  importRecord: ImportDbRow;
  rows: readonly ApplyDbRow[];
  materializedRows: readonly ApplyDbRow[];
  endAssignments: readonly EndAssignmentDbRow[];
  canonicalEffectiveOn: string | undefined;
  expectedRevision: number;
}): SqlGuard[] {
  const guards: SqlGuard[] = [];
  const add = (clause: string, ...values: unknown[]) => {
    // D1 enforces a per-statement SQL limit. Each predicate is independently
    // evaluated in the same atomic batch, with every canonical write gated on
    // the eventual committed import state below.
    guards.push({ sql: `(${clause})`, bindings: values });
  };
  const { importRecord, rows, materializedRows, endAssignments, canonicalEffectiveOn } = input;

  add(
    `EXISTS (
       SELECT 1 FROM assignment_imports import_record
        WHERE import_record.id = ?
          AND import_record.status = 'reviewed'
          AND import_record.source_kind = 'official'
          AND import_record.source_system = ?
          AND import_record.source_snapshot_as_of = ?
          AND import_record.source_observed_at IS ?
          AND import_record.source_observation_time_basis = ?
          AND import_record.reconciliation_revision = ?
     )`,
    importRecord.id,
    importRecord.source_system,
    importRecord.source_snapshot_as_of,
    importRecord.source_observed_at,
    importRecord.source_observation_time_basis,
    input.expectedRevision,
  );
  add(
    '(SELECT COUNT(*) FROM assignment_import_rows WHERE import_id = ?) = ?',
    importRecord.id,
    rows.length,
  );
  add(
    `NOT EXISTS (
       SELECT 1 FROM assignment_import_missing_observations finding
        WHERE finding.import_id = ? AND finding.review_status <> 'resolved'
     )`,
    importRecord.id,
  );

  for (const row of rows) {
    add(
      `EXISTS (
         SELECT 1
           FROM assignment_import_rows source_row
           LEFT JOIN staffing_position_source_mappings source_mapping
             ON source_mapping.id = source_row.staffing_position_source_mapping_id
           LEFT JOIN staffing_positions position_record
             ON position_record.id = source_mapping.staffing_position_id
           LEFT JOIN members member_record ON member_record.id = source_row.resolved_member_id
          WHERE source_row.id = ?
            AND source_row.import_id = ?
            AND source_row.row_fingerprint = ?
            AND source_row.source_a_r_day IS ?
            AND source_row.normalized_source_topology = ?
            AND source_row.source_topology_completeness = ?
            AND source_row.reconciliation_classification IS ?
            AND source_row.review_status = ?
            AND source_row.resolution_action IS ?
            AND source_row.resolved_member_id IS ?
            AND source_row.staffing_position_source_mapping_id IS ?
            AND source_mapping.staffing_position_id IS ?
            AND member_record.employment_status IS ?
            AND member_record.rank IS ?
            AND (
              CASE WHEN source_mapping.id IS NOT NULL
                         AND source_mapping.source_system = ?
                         AND source_mapping.source_locator = source_row.normalized_source_topology
                         AND source_mapping.effective_from <= ?
                         AND (source_mapping.effective_to IS NULL
                           OR source_mapping.effective_to >= ?)
                         AND position_record.review_status = 'approved'
                         AND (position_record.active_from IS NULL
                           OR position_record.active_from <= ?)
                         AND (position_record.active_to IS NULL
                           OR position_record.active_to >= ?)
                   THEN 1 ELSE 0 END
            ) = ?
       )`,
      row.id,
      importRecord.id,
      row.row_fingerprint,
      row.source_a_r_day,
      row.normalized_source_topology,
      row.source_topology_completeness,
      row.reconciliation_classification,
      row.review_status,
      row.resolution_action,
      row.resolved_member_id,
      row.staffing_position_source_mapping_id,
      row.staffing_position_id,
      row.member_employment_status,
      row.member_rank,
      importRecord.source_system,
      importRecord.source_snapshot_as_of,
      importRecord.source_snapshot_as_of,
      importRecord.source_snapshot_as_of,
      importRecord.source_snapshot_as_of,
      row.mapping_is_approved_for_snapshot,
    );
  }

  if (canonicalEffectiveOn !== undefined) {
    for (const row of materializedRows) {
      if (row.resolved_member_id === null || row.staffing_position_id === null) continue;
      add(
        `NOT EXISTS (
           SELECT 1 FROM member_assignments current_assignment
            WHERE current_assignment.staffing_position_id = ?
              AND current_assignment.status <> 'cancelled'
              AND current_assignment.effective_from <= ?
              AND (current_assignment.effective_to IS NULL
                OR current_assignment.effective_to >= ?)
         )`,
        row.staffing_position_id,
        canonicalEffectiveOn,
        canonicalEffectiveOn,
      );
      add(
        `NOT EXISTS (
           SELECT 1 FROM member_assignments newer_assignment
            WHERE newer_assignment.member_id = ?
              AND newer_assignment.status <> 'cancelled'
              AND newer_assignment.staffing_position_id <> ?
              AND (
                newer_assignment.effective_from > ?
                OR (
                  newer_assignment.origin_type <> 'TELESTAFF_IMPORT'
                  AND newer_assignment.effective_from <= ?
                  AND (newer_assignment.effective_to IS NULL OR newer_assignment.effective_to >= ?)
                )
              )
         )`,
        row.resolved_member_id,
        row.staffing_position_id,
        importRecord.source_snapshot_as_of,
        importRecord.source_snapshot_as_of,
        importRecord.source_snapshot_as_of,
      );
      if (row.reconciliation_classification === 'NEW_ASSIGNMENT') {
        add(
          `NOT EXISTS (
             SELECT 1 FROM member_assignments current_assignment
              WHERE current_assignment.member_id = ?
                AND current_assignment.status <> 'cancelled'
                AND current_assignment.effective_from <= ?
                AND (current_assignment.effective_to IS NULL
                  OR current_assignment.effective_to >= ?)
           )`,
          row.resolved_member_id,
          canonicalEffectiveOn,
          canonicalEffectiveOn,
        );
      }
    }
  }

  for (const assignment of endAssignments) {
    add(
      `(
         SELECT COUNT(*) FROM member_assignments current_assignment
          WHERE current_assignment.member_id = ?
            AND current_assignment.status <> 'cancelled'
            AND current_assignment.effective_from <= ?
            AND (current_assignment.effective_to IS NULL
              OR current_assignment.effective_to >= ?)
       ) = 1`,
      assignment.member_id,
      canonicalEffectiveOn,
      canonicalEffectiveOn,
    );
    add(
      `EXISTS (
         SELECT 1 FROM member_assignments current_assignment
          WHERE current_assignment.id = ?
            AND current_assignment.member_id = ?
            AND current_assignment.staffing_position_id = ?
            AND current_assignment.status = ?
            AND current_assignment.effective_from = ?
            AND current_assignment.effective_to IS ?
       )`,
      assignment.id,
      assignment.member_id,
      assignment.staffing_position_id,
      assignment.status,
      assignment.effective_from,
      assignment.effective_to,
    );
  }
  return guards;
}

function lifecycleEvidenceFor(
  importId: string,
  revision: number,
  row: ApplyDbRow,
  canonicalEffectiveOn: string,
  previousAssignment: EndAssignmentDbRow | undefined,
): TeleStaffLifecycleEvidence | null {
  if (
    row.resolved_member_id === null ||
    row.staffing_position_id === null ||
    row.member_employment_status === null ||
    row.member_rank === null
  ) {
    return null;
  }
  const assignmentId = `${importId}:assignment:${row.id}`;
  const eventId = `${importId}:lifecycle:${row.id}`;
  return {
    assignmentId,
    eventId,
    sourceRowId: row.id,
    memberId: row.resolved_member_id,
    staffingPositionId: row.staffing_position_id,
    beforeState: {
      v: 1,
      importId,
      reconciliationRevision: revision,
      memberId: row.resolved_member_id,
      employmentStatus: row.member_employment_status,
      rank: row.member_rank,
      assignment:
        previousAssignment === undefined
          ? null
          : {
              id: previousAssignment.id,
              staffingPositionId: previousAssignment.staffing_position_id,
              status: previousAssignment.status,
              effectiveFrom: previousAssignment.effective_from,
              effectiveTo: previousAssignment.effective_to,
            },
    },
    afterState: {
      v: 1,
      importId,
      reconciliationRevision: revision,
      memberId: row.resolved_member_id,
      employmentStatus: row.member_employment_status,
      rank: row.member_rank,
      assignment: {
        id: assignmentId,
        staffingPositionId: row.staffing_position_id,
        status: 'active',
        effectiveFrom: canonicalEffectiveOn,
        sourceRowId: row.id,
      },
    },
  };
}

function lifecycleStatement(
  db: D1Database,
  row: ApplyDbRow,
  evidence: TeleStaffLifecycleEvidence,
  canonicalEffectiveOn: string,
  actorId: number,
  nowMs: number,
  importId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       SELECT ?, ?, ?, ?, 'ADMIN_REASSIGNMENT', ?, ?, ?, ?, ?, NULL, ?, 'TELESTAFF', ?, ?, ?, ?, NULL, ?
        WHERE EXISTS (
          SELECT 1 FROM assignment_imports apply_import
           WHERE apply_import.id = ? AND apply_import.status = 'committed'
        )`,
    )
    .bind(
      evidence.eventId,
      evidence.memberId,
      evidence.staffingPositionId,
      evidence.assignmentId,
      canonicalEffectiveOn,
      row.member_employment_status,
      row.member_employment_status,
      row.member_rank,
      row.member_rank,
      'TeleStaff official source apply after terminal reconciliation',
      `admin:${actorId}`,
      // Source-row IDs are globally unique and bounded by the route contract;
      // keeping the key row-scoped preserves the lifecycle table's 256-byte
      // limit even for a long legacy import identifier.
      `telestaff:apply:${row.id}`,
      JSON.stringify(evidence.beforeState),
      JSON.stringify(evidence.afterState),
      nowMs,
      importId,
    );
}

function teleStaffApplyAuditStatement(
  db: D1Database,
  input: {
    importId: string;
    revision: number;
    actorId: number;
    sourceSnapshotAsOf: string;
    canonicalEffectiveOn: string | undefined;
    evidence: readonly TeleStaffLifecycleEvidence[];
    endedAssignments: readonly EndAssignmentDbRow[];
    nowMs: number;
  },
): D1PreparedStatement {
  const beforeState = {
    v: 1,
    importId: input.importId,
    reconciliationRevision: input.revision,
    sourceSnapshotAsOf: input.sourceSnapshotAsOf,
    assignments: input.endedAssignments.map((assignment) => ({
      id: assignment.id,
      memberId: assignment.member_id,
      staffingPositionId: assignment.staffing_position_id,
      status: assignment.status,
      effectiveFrom: assignment.effective_from,
      effectiveTo: assignment.effective_to,
    })),
  };
  const afterState = {
    v: 1,
    importId: input.importId,
    reconciliationRevision: input.revision,
    canonicalEffectiveOn: input.canonicalEffectiveOn ?? null,
    createdAssignments: input.evidence.map((entry) => entry.assignmentId),
    lifecycleEventIds: input.evidence.map((entry) => entry.eventId),
    endedAssignmentIds: input.endedAssignments.map((entry) => entry.id),
  };
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at)
       SELECT ?, NULL, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'telestaff_apply',
              'assignment_import', ?, ?, ?, ?, NULL, ?, ?
         FROM audit_log
        WHERE bid_session_id IS NULL
          AND EXISTS (
            SELECT 1 FROM assignment_imports apply_import
             WHERE apply_import.id = ? AND apply_import.status = 'committed'
          )`,
    )
    .bind(
      ulid(),
      input.actorId,
      input.importId,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      'TeleStaff official source apply after terminal reconciliation',
      JSON.stringify({ v: 1, origin: 'TELESTAFF', operation: 'apply' }),
      Math.floor(input.nowMs / 1_000),
      input.importId,
    );
}

const router = new Hono<AdminEnv>();
router.use('*', requireAdmin);

/** Parses only request-memory HTML and returns aggregate, non-PII preview data. */
router.post('/imports/preview', async (c) => {
  if (!hasUsableTeleStaffHmacKey(c.env.TELESTAFF_HMAC_KEY)) {
    return c.json({ error: 'telestaff_configuration_unavailable' }, 503);
  }
  const upload = await readUploadForm(c);
  if (!upload.ok) return c.json({ error: upload.error }, 400);
  const preview = await createTeleStaffOperatorPreview(
    upload.source,
    upload.sourceSnapshotAsOf,
    upload.sourceKind,
    upload,
  );
  if (!preview.ok) {
    const status = preview.code === 'SOURCE_PARSE_REJECTED' ? 422 : 400;
    return c.json({ error: preview.code.toLowerCase() }, status);
  }
  return c.json({ preview, readiness: READINESS });
});

/** Stages sanitized source evidence, then deterministic reconciliation state. */
router.post('/imports', requireStepUpAuth(), async (c) => {
  if (!hasUsableTeleStaffHmacKey(c.env.TELESTAFF_HMAC_KEY)) {
    return c.json({ error: 'telestaff_configuration_unavailable' }, 503);
  }
  const upload = await readUploadForm(c);
  if (!upload.ok) return c.json({ error: upload.error }, 400);
  const preview = await createTeleStaffOperatorPreview(
    upload.source,
    upload.sourceSnapshotAsOf,
    upload.sourceKind,
    upload,
  );
  if (!preview.ok) {
    const status = preview.code === 'SOURCE_PARSE_REJECTED' ? 422 : 400;
    return c.json({ error: preview.code.toLowerCase() }, status);
  }
  const parsed = await parseTeleStaffAssignmentsHtml(upload.source);
  if (!parsed.ok) return c.json({ error: 'source_parse_rejected' }, 422);

  const importId = ulid();
  // The parser truthfully reports that this source format lacks an embedded
  // timestamp/date. The operator-supplied, validated snapshot date is distinct
  // source metadata; it is never treated as an assignment effective date.
  const parsedWithOperatorSnapshot = {
    ...parsed,
    sourceSnapshotAsOf: upload.sourceSnapshotAsOf,
  };
  const staged = await stageParsedTeleStaffAssignmentsHtml(
    c.env.DB,
    parsedWithOperatorSnapshot as unknown as typeof parsed,
    {
      importId,
      sourceKind: upload.sourceKind,
      importedAtMs: Date.now(),
      sourceObservedAt: upload.sourceObservedAt,
      sourceObservationTimeBasis: upload.sourceObservationTimeBasis,
      ...makeTeleStaffHmacFunctions(c.env.TELESTAFF_HMAC_KEY),
    },
  );
  if (!staged.ok) return c.json({ error: 'source_stage_rejected' }, 422);
  const reconciliation = await reconcileStagedTeleStaffImport(c.env.DB, {
    importId,
    hmacKey: c.env.TELESTAFF_HMAC_KEY,
  });
  if (!reconciliation.ok) {
    // This leaves a non-canonical staged record for recovery; never delete
    // source evidence or leak a D1 error body.
    return c.json({ error: 'reconciliation_required', importId }, 202);
  }
  const importRecord = await loadImportSummary(c.env.DB, importId);
  if (importRecord === undefined) return c.json({ error: 'import_not_found' }, 500);
  const unknownRowResult = await c.env.DB.prepare(
    `SELECT id, source_row_number
       FROM assignment_import_rows
      WHERE import_id = ? AND reconciliation_classification = 'UNKNOWN_EMPLOYEE'
      ORDER BY source_row_number ASC, id ASC`,
  )
    .bind(importId)
    .all();
  const unknownRowByNumber = new Map(
    (unknownRowResult.results as unknown as Array<{ id: string; source_row_number: number }>).map(
      (row) => [row.source_row_number, row.id],
    ),
  );
  // This is a one-response, authenticated review handoff. Raw identity remains
  // only in request/browser memory and is never written to D1, logs, exports,
  // public routes, or AI prompts.
  const unknownEmployees = parsed.rows.flatMap((row) => {
    const rowId = unknownRowByNumber.get(row.sourceRowNumber);
    if (rowId === undefined || row.employeeId === null || row.sourceName === null) return [];
    return [
      {
        rowId,
        sourceRowNumber: row.sourceRowNumber,
        sourceEmployeeId: row.employeeId,
        sourceDisplayName: row.sourceName,
      },
    ];
  });
  return c.json(
    {
      import: mapImport(importRecord),
      reconciliation: reconciliation.counts,
      unknownEmployees,
      preview,
      readiness: READINESS,
    },
    201,
  );
});

/** Re-runs exact-HMAC reconciliation after reviewed canonical onboarding. */
router.post('/imports/:importId/reconcile', requireStepUpAuth(), async (c) => {
  const importId = c.req.param('importId');
  if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
  const parsed = ReconcileRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_reconciliation_request' }, 400);
  if (!hasUsableTeleStaffHmacKey(c.env.TELESTAFF_HMAC_KEY)) {
    return c.json({ error: 'telestaff_configuration_unavailable' }, 503);
  }
  const before = await loadImportSummary(c.env.DB, importId);
  if (before === undefined || before.source_kind !== 'official' || before.status !== 'reviewed') {
    return c.json({ error: 'import_not_reconcilable' }, 409);
  }
  if (before.reconciliation_revision !== parsed.data.expected_reconciliation_revision) {
    return c.json({ error: 'reconciliation_revision_conflict' }, 409);
  }
  const reconciliation = await reconcileStagedTeleStaffImport(c.env.DB, {
    importId,
    hmacKey: c.env.TELESTAFF_HMAC_KEY,
  });
  if (!reconciliation.ok) return c.json({ error: 'reconciliation_unavailable' }, 409);
  const after = await loadImportSummary(c.env.DB, importId);
  if (after === undefined) return c.json({ error: 'import_not_found' }, 500);
  return c.json({ import: mapImport(after), reconciliation: reconciliation.counts });
});

/** Lists sanitized import-level history only. */
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
  return c.json({
    imports: (result.results as unknown as ImportDbRow[]).map(mapImport),
    readiness: READINESS,
  });
});

/**
 * Streams one retained import's reconciliation evidence with only derived,
 * non-identifying fields. It intentionally never selects raw source material,
 * source locators, mapping identifiers, member identifiers, or HMAC values.
 */
router.get('/imports/:importId/reconciliation.csv', async (c) => {
  const importId = c.req.param('importId');
  if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
  const importRecord = await loadImportSummary(c.env.DB, importId);
  if (importRecord === undefined) return c.json({ error: 'not_found' }, 404);

  const sourceRowsResult = await c.env.DB.prepare(
    `SELECT
         source_row.source_row_number,
         CASE WHEN source_row.source_a_r_day IS NULL THEN 0 ELSE 1 END AS has_source_a_r_day,
         source_row.reconciliation_classification,
         source_row.review_status,
         source_row.resolution_action,
         source_row.source_topology_completeness,
         CASE WHEN source_row.resolved_member_id IS NULL THEN 0 ELSE 1 END AS has_resolved_member,
         CASE WHEN source_row.staffing_position_source_mapping_id IS NULL THEN 0 ELSE 1 END
           AS has_staffing_position_source_mapping,
         CASE WHEN source_row.reconciliation_classification = 'MOVED'
            AND source_row.resolved_member_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM member_assignments current_assignment
              LEFT JOIN staffing_position_source_mappings source_mapping
                ON source_mapping.id = source_row.staffing_position_source_mapping_id
              WHERE current_assignment.member_id = source_row.resolved_member_id
                AND current_assignment.status <> 'cancelled'
                AND (
                  current_assignment.effective_from > import_record.source_snapshot_as_of
                  OR (
                    current_assignment.origin_type <> 'TELESTAFF_IMPORT'
                    AND current_assignment.effective_from <= import_record.source_snapshot_as_of
                    AND (current_assignment.effective_to IS NULL
                      OR current_assignment.effective_to >= import_record.source_snapshot_as_of)
                  )
                )
                AND (
                  source_mapping.staffing_position_id IS NULL
                  OR current_assignment.staffing_position_id <> source_mapping.staffing_position_id
                )
            ) THEN 1 ELSE 0 END AS is_current_record_newer
       FROM assignment_import_rows source_row
       JOIN assignment_imports import_record ON import_record.id = source_row.import_id
       WHERE source_row.import_id = ?
       ORDER BY source_row.source_row_number ASC, source_row.id ASC
       LIMIT ?`,
  )
    .bind(importId, MAX_RECONCILIATION_EXPORT_RECORDS + 1)
    .all();
  const sourceRows = sourceRowsResult.results as unknown as ReconciliationExportSourceRowDbRow[];
  if (sourceRows.length > MAX_RECONCILIATION_EXPORT_RECORDS) {
    return c.json(
      {
        error: 'reconciliation_export_row_limit_exceeded',
        max_records: MAX_RECONCILIATION_EXPORT_RECORDS,
      },
      413,
    );
  }

  const remainingRecordCapacity = MAX_RECONCILIATION_EXPORT_RECORDS - sourceRows.length;
  const missingFindingsResult = await c.env.DB.prepare(
    `SELECT classification, review_status, resolution_action,
              CASE WHEN member_assignment_id IS NULL THEN 0 ELSE 1 END AS has_assignment_context
       FROM assignment_import_missing_observations
       WHERE import_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
  )
    .bind(importId, remainingRecordCapacity + 1)
    .all();
  const missingFindings =
    missingFindingsResult.results as unknown as ReconciliationExportMissingFindingDbRow[];
  if (missingFindings.length > remainingRecordCapacity) {
    return c.json(
      {
        error: 'reconciliation_export_row_limit_exceeded',
        max_records: MAX_RECONCILIATION_EXPORT_RECORDS,
      },
      413,
    );
  }

  const exportedAt = new Date().toISOString();
  const rows: ReconciliationExportRow[] = [
    reconciliationExportRow('import_summary', {
      importStatus: safeExportCode(importRecord.status),
      sourceKind: safeExportCode(importRecord.source_kind),
      sourceSnapshotAsOf: safeExportCalendarDate(importRecord.source_snapshot_as_of),
      sourceObservedAt: safeExportTimestamp(importRecord.source_observed_at),
      sourceObservationTimeBasis: safeExportCode(importRecord.source_observation_time_basis),
      reconciliationRevision: safeNonNegativeInteger(importRecord.reconciliation_revision),
      inputRowCount: safeNonNegativeInteger(importRecord.input_row_count),
      normalizedDataRowCount: safeNonNegativeInteger(importRecord.normalized_data_row_count),
      uniqueEmployeeCount: safeNonNegativeInteger(importRecord.unique_employee_count),
      reportRowCount: safeNonNegativeInteger(importRecord.report_row_count),
      structuralRowCount: safeNonNegativeInteger(importRecord.structural_row_count),
      sourceRowCount: sourceRows.length,
      pendingSourceRowCount: sourceRows.filter((row) => row.review_status === 'pending').length,
      hardBlockerSourceRowCount: safeNonNegativeInteger(importRecord.hard_blocker_source_row_count),
      incompleteTopologySourceRowCount: sourceRows.filter(
        (row) => row.source_topology_completeness === 'incomplete',
      ).length,
      missingObservationFindingCount: missingFindings.length,
      pendingMissingObservationFindingCount: missingFindings.filter(
        (finding) => finding.review_status === 'pending',
      ).length,
      importCreatedAt: safeExportTimestamp(importRecord.created_at),
      approvedAt: safeExportTimestamp(importRecord.approved_at),
      committedAt: safeExportTimestamp(importRecord.committed_at),
      exportedAt,
    }),
    ...sourceRows.map((row) => {
      const isCurrentRecordNewer = row.is_current_record_newer === 1;
      const allowedReviewActions = allowedReviewActionsFor({
        classification: row.reconciliation_classification,
        isCurrentRecordNewer,
      });
      return reconciliationExportRow('source_row', {
        sourceRowNumber: safeNonNegativeInteger(row.source_row_number),
        reconciliationClassification: safeExportCode(row.reconciliation_classification),
        reviewStatus: safeExportCode(row.review_status),
        resolutionAction: safeExportCode(row.resolution_action),
        sourceTopologyCompleteness: safeExportCode(row.source_topology_completeness),
        hasSourceARDay: row.has_source_a_r_day === 1,
        hasResolvedMember: row.has_resolved_member === 1,
        hasStaffingPositionSourceMapping: row.has_staffing_position_source_mapping === 1,
        isCurrentRecordNewer,
        reviewState: safeExportCode(
          reviewStateFor({
            classification: row.reconciliation_classification,
            isCurrentRecordNewer,
          }),
        ),
        allowedReviewActions:
          allowedReviewActions.length === 0 ? null : allowedReviewActions.join('|'),
      });
    }),
    ...missingFindings.map((finding) =>
      reconciliationExportRow('missing_observation_finding', {
        reconciliationClassification: safeExportCode(finding.classification),
        reviewStatus: safeExportCode(finding.review_status),
        resolutionAction: safeExportCode(finding.resolution_action),
        hasAssignmentContext: finding.has_assignment_context === 1,
      }),
    ),
  ];

  async function* rowSource(): AsyncIterable<ReconciliationExportRow> {
    yield* rows;
  }

  return new Response(
    createCsvStream(rowSource(), [
      { header: 'record_type', value: (row) => row.recordType },
      { header: 'import_status', value: (row) => row.importStatus },
      { header: 'source_kind', value: (row) => row.sourceKind },
      { header: 'source_snapshot_as_of', value: (row) => row.sourceSnapshotAsOf },
      { header: 'source_observed_at', value: (row) => row.sourceObservedAt },
      {
        header: 'source_observation_time_basis',
        value: (row) => row.sourceObservationTimeBasis,
      },
      { header: 'reconciliation_revision', value: (row) => row.reconciliationRevision },
      { header: 'input_row_count', value: (row) => row.inputRowCount },
      { header: 'normalized_data_row_count', value: (row) => row.normalizedDataRowCount },
      { header: 'unique_employee_count', value: (row) => row.uniqueEmployeeCount },
      { header: 'report_row_count', value: (row) => row.reportRowCount },
      { header: 'structural_row_count', value: (row) => row.structuralRowCount },
      { header: 'source_row_count', value: (row) => row.sourceRowCount },
      { header: 'pending_source_row_count', value: (row) => row.pendingSourceRowCount },
      {
        header: 'hard_blocker_source_row_count',
        value: (row) => row.hardBlockerSourceRowCount,
      },
      {
        header: 'incomplete_topology_source_row_count',
        value: (row) => row.incompleteTopologySourceRowCount,
      },
      {
        header: 'missing_observation_finding_count',
        value: (row) => row.missingObservationFindingCount,
      },
      {
        header: 'pending_missing_observation_finding_count',
        value: (row) => row.pendingMissingObservationFindingCount,
      },
      { header: 'import_created_at', value: (row) => row.importCreatedAt },
      { header: 'approved_at', value: (row) => row.approvedAt },
      { header: 'committed_at', value: (row) => row.committedAt },
      { header: 'exported_at', value: (row) => row.exportedAt },
      { header: 'source_row_number', value: (row) => row.sourceRowNumber },
      {
        header: 'reconciliation_classification',
        value: (row) => row.reconciliationClassification,
      },
      { header: 'review_status', value: (row) => row.reviewStatus },
      { header: 'resolution_action', value: (row) => row.resolutionAction },
      {
        header: 'source_topology_completeness',
        value: (row) => row.sourceTopologyCompleteness,
      },
      { header: 'has_source_a_r_day', value: (row) => row.hasSourceARDay },
      { header: 'has_resolved_member', value: (row) => row.hasResolvedMember },
      {
        header: 'has_staffing_position_source_mapping',
        value: (row) => row.hasStaffingPositionSourceMapping,
      },
      { header: 'is_current_record_newer', value: (row) => row.isCurrentRecordNewer },
      { header: 'review_state', value: (row) => row.reviewState },
      { header: 'allowed_review_actions', value: (row) => row.allowedReviewActions },
      { header: 'has_assignment_context', value: (row) => row.hasAssignmentContext },
    ]),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="mbfd-telestaff-reconciliation.csv"',
        'Cache-Control': 'no-store',
      },
    },
  );
});

/** Sanitized reconciliation queue and derived review-state actions. */
router.get('/imports/:importId', async (c) => {
  const importId = c.req.param('importId');
  if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
  const parsedLimit = parsePositivePageSize(c.req.query('limit'));
  if (parsedLimit.error) return c.json({ error: parsedLimit.error }, 400);
  const parsedOffset = parseOffset(c.req.query('offset'));
  if (parsedOffset.error) return c.json({ error: parsedOffset.error }, 400);
  const importRow = await loadImportSummary(c.env.DB, importId);
  if (importRow === undefined) return c.json({ error: 'not_found' }, 404);

  const [rowsResult, rowCountResult, missingFindingsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
           source_row.id,
           source_row.source_row_number,
           CASE WHEN source_row.source_a_r_day IS NULL THEN 0 ELSE 1 END AS has_source_a_r_day,
           source_row.disposition,
           source_row.reconciliation_classification,
           source_row.review_status,
           source_row.resolution_action,
           source_row.source_topology_completeness,
           CASE WHEN source_row.resolved_member_id IS NULL THEN 0 ELSE 1 END AS has_resolved_member,
           CASE WHEN source_row.staffing_position_source_mapping_id IS NULL THEN 0 ELSE 1 END
             AS has_staffing_position_source_mapping,
           CASE WHEN source_row.reconciliation_classification = 'MOVED'
              AND source_row.resolved_member_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM member_assignments current_assignment
                LEFT JOIN staffing_position_source_mappings source_mapping
                  ON source_mapping.id = source_row.staffing_position_source_mapping_id
                WHERE current_assignment.member_id = source_row.resolved_member_id
                  AND current_assignment.status <> 'cancelled'
                  AND (
                    current_assignment.effective_from > import_record.source_snapshot_as_of
                    OR (
                      current_assignment.origin_type <> 'TELESTAFF_IMPORT'
                      AND current_assignment.effective_from <= import_record.source_snapshot_as_of
                      AND (current_assignment.effective_to IS NULL
                        OR current_assignment.effective_to >= import_record.source_snapshot_as_of)
                    )
                  )
                  AND (
                    source_mapping.staffing_position_id IS NULL
                    OR current_assignment.staffing_position_id <> source_mapping.staffing_position_id
                  )
              ) THEN 1 ELSE 0 END AS is_current_record_newer
         FROM assignment_import_rows source_row
         JOIN assignment_imports import_record ON import_record.id = source_row.import_id
         WHERE source_row.import_id = ?
         ORDER BY source_row.source_row_number ASC, source_row.id ASC
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
      `SELECT id, classification, review_status, resolution_action, reviewed_at,
                CASE WHEN member_assignment_id IS NULL THEN 0 ELSE 1 END AS has_assignment_context
         FROM assignment_import_missing_observations
         WHERE import_id = ? ORDER BY created_at ASC, id ASC`,
    )
      .bind(importId)
      .all(),
  ]);
  const rows = (rowsResult.results as unknown as ImportRowDbRow[]).map((row) => {
    const isCurrentRecordNewer = row.is_current_record_newer === 1;
    return {
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
      reviewState: reviewStateFor({
        classification: row.reconciliation_classification,
        isCurrentRecordNewer,
      }),
      allowedReviewActions: allowedReviewActionsFor({
        classification: row.reconciliation_classification,
        isCurrentRecordNewer,
      }),
    };
  });
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
    pagination: { limit: parsedLimit.value, offset: parsedOffset.value, totalRows: totalRows ?? 0 },
    readiness: READINESS,
  });
});

/** Records a controlled immutable resolution, with no free-text source material. */
router.patch('/imports/:importId/rows/:rowId/review', requireStepUpAuth(), async (c) => {
  const importId = c.req.param('importId');
  const rowId = c.req.param('rowId');
  if (!isOpaqueId(importId) || !isOpaqueId(rowId))
    return c.json({ error: 'invalid_identifier' }, 400);
  const raw = await c.req.json().catch(() => null);
  const parsed = ReviewRequestSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  const reviewerId = actorMemberId(c.get('claims'));
  if (reviewerId === null) return c.json({ error: 'operator_identity_required' }, 403);

  const sourceRowResult = await c.env.DB.prepare(
    `SELECT source_row.reconciliation_classification,
              CASE WHEN source_row.reconciliation_classification = 'MOVED'
                 AND source_row.resolved_member_id IS NOT NULL
                 AND EXISTS (
                   SELECT 1
                   FROM member_assignments current_assignment
                   LEFT JOIN staffing_position_source_mappings source_mapping
                     ON source_mapping.id = source_row.staffing_position_source_mapping_id
                   JOIN assignment_imports import_record ON import_record.id = source_row.import_id
                   WHERE current_assignment.member_id = source_row.resolved_member_id
                     AND current_assignment.status <> 'cancelled'
                     AND (
                       current_assignment.effective_from > import_record.source_snapshot_as_of
                       OR (
                         current_assignment.origin_type <> 'TELESTAFF_IMPORT'
                         AND current_assignment.effective_from <= import_record.source_snapshot_as_of
                         AND (current_assignment.effective_to IS NULL
                           OR current_assignment.effective_to >= import_record.source_snapshot_as_of)
                       )
                     )
                     AND (source_mapping.staffing_position_id IS NULL
                       OR current_assignment.staffing_position_id <> source_mapping.staffing_position_id)
                 ) THEN 1 ELSE 0 END AS is_current_record_newer
       FROM assignment_import_rows source_row
       WHERE source_row.id = ? AND source_row.import_id = ?`,
  )
    .bind(rowId, importId)
    .all();
  const sourceRow = sourceRowResult.results[0] as
    | { reconciliation_classification: string | null; is_current_record_newer: number }
    | undefined;
  if (sourceRow === undefined) return c.json({ error: 'not_found' }, 404);
  const mutation = reviewMutationFor(
    sourceRow.reconciliation_classification,
    parsed.data.decision,
    sourceRow.is_current_record_newer === 1,
  );
  if (mutation === null) return c.json({ error: 'unsafe_review_decision' }, 409);

  const updated = await c.env.DB.prepare(
    `UPDATE assignment_import_rows
          SET review_status = ?, resolution_action = ?, reviewed_at = ?, reviewed_by_member_id = ?,
              resolution_reason = ?
        WHERE id = ? AND import_id = ?
          AND EXISTS (
            SELECT 1 FROM assignment_imports import_record
            WHERE import_record.id = ? AND import_record.status = 'reviewed'
              AND import_record.reconciliation_revision = ?
          )`,
  )
    .bind(
      mutation.reviewStatus,
      mutation.resolutionAction,
      Date.now(),
      reviewerId,
      mutation.reasonCode,
      rowId,
      importId,
      importId,
      parsed.data.expected_reconciliation_revision,
    )
    .run();
  // Native D1 includes the reconciliation-revision trigger in `changes`,
  // while the local test adapter reports only the directly updated row. The
  // guarded predicate can update at most one source row, so any positive
  // count proves this review mutation won; only zero proves a stale revision.
  if (updated.meta.changes < 1) return c.json({ error: 'reconciliation_changed' }, 409);
  const importRecord = await loadImportSummary(c.env.DB, importId);
  if (importRecord === undefined) return c.json({ error: 'not_found' }, 404);
  return c.json({
    import: mapImport(importRecord),
    row: { reviewStatus: mutation.reviewStatus, resolutionAction: mutation.resolutionAction },
  });
});

/**
 * Records the same accept-observation decision as the per-row control for all
 * currently safe deterministic rows. This avoids making a large official
 * import impossible to finish when its review queue exceeds one UI page.
 */
router.post(
  '/imports/:importId/review-deterministic-observations',
  requireStepUpAuth(),
  async (c) => {
    const importId = c.req.param('importId');
    if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
    const parsed = DeterministicReviewRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_review_request' }, 400);
    const actorId = actorMemberId(c.get('claims'));
    if (actorId === null) return c.json({ error: 'operator_identity_required' }, 403);

    const importRecord = await loadImportSummary(c.env.DB, importId);
    if (
      importRecord === undefined ||
      importRecord.source_kind !== 'official' ||
      importRecord.status !== 'reviewed'
    )
      return c.json({ error: 'import_not_reviewable' }, 409);
    if (importRecord.reconciliation_revision !== parsed.data.expected_reconciliation_revision)
      return c.json({ error: 'reconciliation_revision_conflict' }, 409);

    const now = Date.now();
    const updated = await c.env.DB.prepare(
      `WITH eligible_import(id) AS MATERIALIZED (
       SELECT id FROM assignment_imports
        WHERE id = ? AND source_kind = 'official' AND status = 'reviewed'
          AND reconciliation_revision = ?
     )
     UPDATE assignment_import_rows
        SET review_status = 'approved', resolution_action = 'APPLY_OBSERVATION',
            reviewed_at = ?, reviewed_by_member_id = ?,
            resolution_reason = 'ACCEPT_TELESTAFF_OBSERVATION'
      WHERE import_id IN (SELECT id FROM eligible_import)
        AND review_status = 'pending'
        AND reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
        AND NOT (
          reconciliation_classification = 'MOVED'
          AND resolved_member_id IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM member_assignments current_assignment
              LEFT JOIN staffing_position_source_mappings source_mapping
                ON source_mapping.id = assignment_import_rows.staffing_position_source_mapping_id
              JOIN assignment_imports import_record ON import_record.id = assignment_import_rows.import_id
             WHERE current_assignment.member_id = assignment_import_rows.resolved_member_id
               AND current_assignment.status <> 'cancelled'
               AND (
                 current_assignment.effective_from > import_record.source_snapshot_as_of
                 OR (
                   current_assignment.origin_type <> 'TELESTAFF_IMPORT'
                   AND current_assignment.effective_from <= import_record.source_snapshot_as_of
                   AND (current_assignment.effective_to IS NULL
                     OR current_assignment.effective_to >= import_record.source_snapshot_as_of)
                 )
               )
               AND (source_mapping.staffing_position_id IS NULL
                 OR current_assignment.staffing_position_id <> source_mapping.staffing_position_id)
          )
        )
      RETURNING id`,
    )
      .bind(importId, parsed.data.expected_reconciliation_revision, now, actorId)
      .all();
    const acceptedObservations = updated.results.length;
    if (acceptedObservations === 0) {
      const refreshed = await loadImportSummary(c.env.DB, importId);
      if (
        refreshed !== undefined &&
        refreshed.reconciliation_revision !== parsed.data.expected_reconciliation_revision
      )
        return c.json({ error: 'reconciliation_changed' }, 409);
      return c.json({
        import: refreshed === undefined ? null : mapImport(refreshed),
        acceptedObservations: 0,
        idempotent: true,
      });
    }

    await c.env.DB.prepare(
      `INSERT INTO audit_log
       (id, bid_session_id, seq, actor_type, actor_id, action, target_kind, target_id,
        before_state, after_state, reason, client_meta, created_at)
     SELECT ?, NULL, COALESCE(MAX(seq), 0) + 1, 'admin', ?,
            'telestaff_deterministic_observations_review', 'assignment_import', ?, ?, ?, ?, ?, ?
       FROM audit_log WHERE bid_session_id IS NULL`,
    )
      .bind(
        ulid(),
        actorId,
        importId,
        JSON.stringify({
          v: 1,
          reconciliationRevision: parsed.data.expected_reconciliation_revision,
          pendingDeterministicObservations: acceptedObservations,
        }),
        JSON.stringify({ v: 1, acceptedObservations }),
        parsed.data.reason,
        JSON.stringify({ v: 1, operation: 'telestaff_deterministic_observations_review' }),
        Math.floor(now / 1000),
      )
      .run();
    const refreshed = await loadImportSummary(c.env.DB, importId);
    return c.json({
      import: refreshed === undefined ? null : mapImport(refreshed),
      acceptedObservations,
      idempotent: false,
    });
  },
);

/**
 * Terminally resolves only evidence that cannot safely materialize a staffing
 * position: repeated complete topology, incomplete topology, and unknown
 * personnel. It never creates or changes canonical staffing.
 */
router.post('/imports/:importId/resolve-safe-exceptions', requireStepUpAuth(), async (c) => {
  const importId = c.req.param('importId');
  if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
  const parsed = SafeExceptionResolutionRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: 'invalid_resolution_request' }, 400);
  const actorId = actorMemberId(c.get('claims'));
  if (actorId === null) return c.json({ error: 'operator_identity_required' }, 403);

  const importRecord = await loadImportSummary(c.env.DB, importId);
  if (
    importRecord === undefined ||
    importRecord.source_kind !== 'official' ||
    importRecord.status !== 'reviewed'
  )
    return c.json({ error: 'import_not_reviewable' }, 409);
  if (importRecord.reconciliation_revision !== parsed.data.expected_reconciliation_revision)
    return c.json({ error: 'reconciliation_revision_conflict' }, 409);

  const result = await c.env.DB.prepare(
    `SELECT id, reconciliation_classification, normalized_source_topology
       FROM assignment_import_rows
      WHERE import_id = ? AND review_status = 'pending'
        AND reconciliation_classification IN ('NEW_POSITION', 'INCOMPLETE_TOPOLOGY', 'UNKNOWN_EMPLOYEE')
      ORDER BY id ASC`,
  )
    .bind(importId)
    .all();
  const rows = result.results as unknown as Array<{
    id: string;
    reconciliation_classification: 'NEW_POSITION' | 'INCOMPLETE_TOPOLOGY' | 'UNKNOWN_EMPLOYEE';
    normalized_source_topology: string | null;
  }>;
  const repeated = new Map<string, number>();
  for (const row of rows) {
    if (
      row.reconciliation_classification === 'NEW_POSITION' &&
      row.normalized_source_topology !== null
    )
      repeated.set(
        row.normalized_source_topology,
        (repeated.get(row.normalized_source_topology) ?? 0) + 1,
      );
  }
  if (
    rows.some(
      (row) =>
        row.reconciliation_classification === 'NEW_POSITION' &&
        (row.normalized_source_topology === null ||
          (repeated.get(row.normalized_source_topology) ?? 0) < 2),
    )
  )
    return c.json({ error: 'non_repeated_new_position_requires_individual_review' }, 409);

  const now = Date.now();
  const counts = {
    deferredRepeatedTopology: 0,
    retainedIncompleteTopology: 0,
    rejectedUnknownPerson: 0,
  };
  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    const mutation =
      row.reconciliation_classification === 'NEW_POSITION'
        ? {
            reviewStatus: 'approved',
            action: 'DEFER_NEW_POSITION',
            reason: 'DEFER_REPEATED_SOURCE_TOPOLOGY',
          }
        : row.reconciliation_classification === 'INCOMPLETE_TOPOLOGY'
          ? {
              reviewStatus: 'approved',
              action: 'RETAIN_UNMATERIALIZED_SOURCE_ROW',
              reason: 'RETAIN_INCOMPLETE_SOURCE_ROW',
            }
          : {
              reviewStatus: 'rejected',
              action: 'REJECT_SOURCE_ROW',
              reason: 'REJECT_UNKNOWN_PERSON',
            };
    if (row.reconciliation_classification === 'NEW_POSITION') counts.deferredRepeatedTopology += 1;
    else if (row.reconciliation_classification === 'INCOMPLETE_TOPOLOGY')
      counts.retainedIncompleteTopology += 1;
    else counts.rejectedUnknownPerson += 1;
    statements.push(
      c.env.DB.prepare(
        `UPDATE assignment_import_rows
            SET review_status = ?, resolution_action = ?, reviewed_at = ?, reviewed_by_member_id = ?,
                resolution_reason = ?
          WHERE id = ? AND import_id = ? AND review_status = 'pending'`,
      ).bind(
        mutation.reviewStatus,
        mutation.action,
        now,
        actorId,
        mutation.reason,
        row.id,
        importId,
      ),
    );
  }
  if (statements.length === 0)
    return c.json({ import: mapImport(importRecord), counts, idempotent: true });
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO audit_log
       (id, bid_session_id, seq, actor_type, actor_id, action, target_kind, target_id,
        before_state, after_state, reason, client_meta, created_at)
       SELECT ?, NULL, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'telestaff_safe_exception_resolve',
              'assignment_import', ?, ?, ?, ?, ?, ? FROM audit_log WHERE bid_session_id IS NULL`,
    ).bind(
      ulid(),
      actorId,
      importId,
      JSON.stringify({ v: 1, pendingRows: rows.length }),
      JSON.stringify({ v: 1, ...counts }),
      parsed.data.reason,
      JSON.stringify({ v: 1, operation: 'telestaff_safe_exception_resolve' }),
      Math.floor(now / 1000),
    ),
  );
  await c.env.DB.batch(statements);
  const updated = await loadImportSummary(c.env.DB, importId);
  return c.json({
    import: updated === undefined ? null : mapImport(updated),
    counts,
    idempotent: false,
  });
});

/** Applies terminal official evidence only, guarded by fresh canonical-state checks. */
/**
 * Certifies only complete, uniquely occurring official TeleStaff topology.
 * Repeated source topology deliberately remains in review: source rows contain
 * no seat discriminator, so choosing a seat from an incumbent or row order
 * would manufacture canonical identity.
 */
router.post('/imports/:importId/certify-deterministic-staffing', requireStepUpAuth(), async (c) => {
  const importId = c.req.param('importId');
  if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
  const raw = await c.req.json().catch(() => null);
  const parsed = StaffingCertificationRequestSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_certification_request' }, 400);
  const actorId = actorMemberId(c.get('claims'));
  if (actorId === null) return c.json({ error: 'real_hub_admin_required' }, 403);

  const importRecord = await c.env.DB.prepare(
    `SELECT id, source_system, source_version, source_hash, source_kind, status,
            source_snapshot_as_of, reconciliation_revision
       FROM assignment_imports WHERE id = ?`,
  )
    .bind(importId)
    .all();
  const manifest = importRecord.results[0] as unknown as
    | {
        id: string;
        source_system: string;
        source_version: string;
        source_hash: string;
        source_kind: string;
        status: string;
        source_snapshot_as_of: string | null;
        reconciliation_revision: number;
      }
    | undefined;
  if (
    manifest === undefined ||
    manifest.source_system !== 'telestaff' ||
    manifest.source_kind !== 'official' ||
    manifest.source_snapshot_as_of === null ||
    !isCalendarDate(manifest.source_snapshot_as_of) ||
    (manifest.status !== 'staged' && manifest.status !== 'reviewed')
  )
    return c.json({ error: 'import_not_certifiable' }, 409);
  if (manifest.reconciliation_revision !== parsed.data.expected_reconciliation_revision) {
    return c.json({ error: 'reconciliation_revision_conflict' }, 409);
  }

  const rowResult = await c.env.DB.prepare(
    `SELECT row_record.id, row_record.normalized_source_topology, row_record.row_fingerprint,
            row_record.resolved_member_id, member_record.rank AS member_rank,
            member_record.employment_status
       FROM assignment_import_rows row_record
       JOIN members member_record ON member_record.id = row_record.resolved_member_id
      WHERE row_record.import_id = ?
        AND row_record.source_topology_completeness = 'complete'
        AND row_record.reconciliation_classification = 'NEW_POSITION'
        AND row_record.review_status = 'pending'
      ORDER BY row_record.id ASC`,
  )
    .bind(importId)
    .all();
  const candidates = rowResult.results as unknown as Array<{
    id: string;
    normalized_source_topology: string;
    row_fingerprint: string;
    resolved_member_id: number;
    member_rank: string;
    employment_status: string;
  }>;
  const grouped = new Map<string, typeof candidates>();
  for (const row of candidates)
    grouped.set(row.normalized_source_topology, [
      ...(grouped.get(row.normalized_source_topology) ?? []),
      row,
    ]);
  // A source report may prove several occupied copies of one topology without
  // naming seats. The resulting seat labels are strictly internal cardinality
  // labels: they come from opaque row-fingerprint order, never imply a Bid
  // policy distinction, and are allowed only when every row proves a distinct
  // current occupant.
  const repeatedRowCount = [...grouped.values()]
    .filter((rows) => rows.length > 1)
    .reduce((count, rows) => count + rows.length, 0);
  const eligible = [...grouped.values()].flatMap((rows) => {
    const ordered = [...rows].sort((left, right) =>
      left.row_fingerprint.localeCompare(right.row_fingerprint),
    );
    const distinctOccupants = new Set(ordered.map((row) => row.resolved_member_id)).size;
    if (ordered.length > 1 && distinctOccupants !== ordered.length) return [];
    return ordered.map((row, index) => ({
      row,
      sourceDiscriminator:
        ordered.length === 1
          ? 'primary'
          : `canonical-cardinality-${String(index + 1).padStart(3, '0')}`,
    }));
  });
  const unresolvedObservationCount = candidates.length - eligible.length;
  if (eligible.length === 0) {
    const priorCertification = await c.env.DB.prepare(
      `SELECT after_state
         FROM audit_log
        WHERE bid_session_id IS NULL
          AND action = 'telestaff_staffing_certify'
          AND target_kind = 'assignment_import'
          AND target_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    )
      .bind(importId)
      .all();
    const afterState = priorCertification.results[0]?.after_state;
    let existingIdempotentMatches = 0;
    if (typeof afterState === 'string') {
      try {
        const parsedAfterState = JSON.parse(afterState) as { certifiedRows?: unknown };
        if (
          typeof parsedAfterState.certifiedRows === 'number' &&
          Number.isInteger(parsedAfterState.certifiedRows) &&
          parsedAfterState.certifiedRows > 0
        ) {
          existingIdempotentMatches = parsedAfterState.certifiedRows;
        }
      } catch {
        // A malformed historic audit record is not evidence of safe replay.
      }
    }
    if (existingIdempotentMatches === 0)
      return c.json({ error: 'no_deterministic_new_position_rows', repeatedRowCount }, 409);

    const updated = await loadImportSummary(c.env.DB, importId);
    return c.json({
      import: updated === undefined ? null : mapImport(updated),
      certifiedRows: 0,
      repeatedRowCount,
      certification: {
        requestedCertifications: existingIdempotentMatches,
        createdCanonicalStaffingPositions: 0,
        createdSourceMappings: 0,
        existingIdempotentMatches,
        unresolvedObservations: unresolvedObservationCount,
        skippedCollisions: 0,
        failures: [],
        idempotent: true,
      },
    });
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const certified: Array<{
    rowId: string;
    positionId: string;
    mappingId: string;
    topology: string;
    sourceDiscriminator: string;
  }> = [];
  for (const eligibleRow of eligible) {
    const { row, sourceDiscriminator } = eligibleRow;
    if (
      !['active', 'unknown'].includes(row.employment_status) ||
      !['CIVILIAN', 'FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'].includes(row.member_rank)
    ) {
      return c.json({ error: 'member_not_certifiable' }, 409);
    }
    let topology: {
      v: number;
      shift: string;
      division: string;
      station: string;
      unit: string;
      position: string;
    };
    try {
      topology = JSON.parse(row.normalized_source_topology) as typeof topology;
    } catch {
      return c.json({ error: 'invalid_source_topology' }, 409);
    }
    if (
      topology.v !== 1 ||
      ![
        topology.shift,
        topology.division,
        topology.station,
        topology.unit,
        topology.position,
      ].every((value) => typeof value === 'string' && value.trim() !== '')
    )
      return c.json({ error: 'invalid_source_topology' }, 409);
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(row.normalized_source_topology),
        ),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const existing = await c.env.DB.prepare(
      `SELECT 1 FROM staffing_position_source_mappings
        WHERE source_system = 'telestaff' AND source_locator = ? AND source_discriminator = ? LIMIT 1`,
    )
      .bind(row.normalized_source_topology, sourceDiscriminator)
      .all();
    if (existing.results.length > 0) return c.json({ error: 'canonical_mapping_collision' }, 409);
    const positionId = ulid();
    const mappingId = ulid();
    certified.push({
      rowId: row.id,
      positionId,
      mappingId,
      topology: row.normalized_source_topology,
      sourceDiscriminator,
    });
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO staffing_positions
           (id, stable_slot_key, division, shift, station, unit, position_name, applicable_rank,
            active_from, review_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
      ).bind(
        positionId,
        `TELSTAFF/v1/${digest}/${sourceDiscriminator}`,
        topology.division,
        topology.shift,
        topology.station,
        topology.unit,
        topology.position,
        row.member_rank,
        manifest.source_snapshot_as_of,
        now,
        now,
      ),
      c.env.DB.prepare(
        `INSERT INTO staffing_position_source_mappings
           (id, staffing_position_id, source_system, source_locator, source_discriminator,
            source_signature, source_version, source_hash, effective_from, created_at)
         VALUES (?, ?, 'telestaff', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        mappingId,
        positionId,
        row.normalized_source_topology,
        sourceDiscriminator,
        row.row_fingerprint,
        manifest.source_version,
        manifest.source_hash,
        manifest.source_snapshot_as_of,
        now,
      ),
      c.env.DB.prepare(
        `UPDATE assignment_import_rows
            SET staffing_position_source_mapping_id = ?, disposition = 'new_combination',
                reconciliation_classification = 'NEW_ASSIGNMENT', review_status = 'approved',
                resolution_action = 'APPLY_OBSERVATION', reviewed_at = ?, reviewed_by_member_id = ?,
                resolution_reason = ?
          WHERE id = ? AND import_id = ? AND reconciliation_classification = 'NEW_POSITION'
            AND review_status = 'pending'`,
      ).bind(mappingId, now, actorId, parsed.data.reason, row.id, importId),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO audit_log
       (id, bid_session_id, seq, actor_type, actor_id, action, target_kind, target_id,
        before_state, after_state, reason, client_meta, created_at)
     SELECT ?, NULL, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'telestaff_staffing_certify',
            'assignment_import', ?, ?, ?, ?, ?, ? FROM audit_log WHERE bid_session_id IS NULL`,
    ).bind(
      ulid(),
      actorId,
      importId,
      JSON.stringify({
        v: 1,
        importId,
        reconciliationRevision: manifest.reconciliation_revision,
        sourceSnapshotAsOf: manifest.source_snapshot_as_of,
      }),
      JSON.stringify({
        v: 1,
        certifiedRows: certified.length,
        repeatedRowCount,
        sourceMappings: certified.map((entry) => ({
          positionId: entry.positionId,
          mappingId: entry.mappingId,
          topology: entry.topology,
          sourceDiscriminator: entry.sourceDiscriminator,
        })),
      }),
      parsed.data.reason,
      JSON.stringify({ v: 1, operation: 'telestaff_staffing_certify' }),
      Math.floor(now / 1000),
    ),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    console.error('telestaff staffing certification failed', error);
    return c.json({ error: 'staffing_certification_not_applied' }, 409);
  }
  const updated = await loadImportSummary(c.env.DB, importId);
  return c.json(
    {
      import: updated === undefined ? null : mapImport(updated),
      certifiedRows: certified.length,
      repeatedRowCount,
      certification: {
        requestedCertifications: certified.length,
        createdCanonicalStaffingPositions: certified.length,
        createdSourceMappings: certified.length,
        existingIdempotentMatches: 0,
        unresolvedObservations: unresolvedObservationCount,
        skippedCollisions: 0,
        failures: [],
        idempotent: false,
      },
    },
    201,
  );
});

router.post('/imports/:importId/apply', requireStepUpAuth(), async (c) => {
  const importId = c.req.param('importId');
  if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
  const raw = await c.req.json().catch(() => null);
  const parsed = ApplyRequestSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  const actorId = actorMemberId(c.get('claims'));
  if (actorId === null) return c.json({ error: 'operator_identity_required' }, 403);
  const importRecord = await loadImportSummary(c.env.DB, importId);
  if (importRecord === undefined) return c.json({ error: 'not_found' }, 404);
  if (importRecord.source_kind === 'synthetic_test') {
    return c.json({ error: 'synthetic_source_cannot_apply' }, 409);
  }
  if (importRecord.source_kind !== 'official')
    return c.json({ error: 'official_source_required' }, 409);
  if (importRecord.status !== 'reviewed') return c.json({ error: 'import_not_reviewable' }, 409);
  if (importRecord.reconciliation_revision !== parsed.data.expected_reconciliation_revision) {
    return c.json({ error: 'reconciliation_changed' }, 409);
  }
  const sourceSnapshotAsOf = importRecord.source_snapshot_as_of;
  if (sourceSnapshotAsOf === null || !isCalendarDate(sourceSnapshotAsOf)) {
    return c.json({ error: 'invalid_source_snapshot_as_of' }, 409);
  }

  const [rowsResult, missingFindingsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT source_row.id, source_row.reconciliation_classification, source_row.review_status,
                source_row.resolution_action, source_row.row_fingerprint, source_row.source_a_r_day,
                source_row.normalized_source_topology, source_row.source_topology_completeness,
                source_row.resolved_member_id,
                source_row.staffing_position_source_mapping_id, source_mapping.staffing_position_id,
                member_record.employment_status AS member_employment_status,
                member_record.rank AS member_rank,
                CASE WHEN source_mapping.id IS NOT NULL
                           AND source_mapping.source_system = import_record.source_system
                           AND source_mapping.source_locator = source_row.normalized_source_topology
                           AND source_mapping.effective_from <= import_record.source_snapshot_as_of
                           AND (source_mapping.effective_to IS NULL
                             OR source_mapping.effective_to >= import_record.source_snapshot_as_of)
                           AND position_record.review_status = 'approved'
                           AND (position_record.active_from IS NULL
                             OR position_record.active_from <= import_record.source_snapshot_as_of)
                           AND (position_record.active_to IS NULL
                             OR position_record.active_to >= import_record.source_snapshot_as_of)
                     THEN 1 ELSE 0 END AS mapping_is_approved_for_snapshot
         FROM assignment_import_rows source_row
         JOIN assignment_imports import_record ON import_record.id = source_row.import_id
         LEFT JOIN staffing_position_source_mappings source_mapping
           ON source_mapping.id = source_row.staffing_position_source_mapping_id
         LEFT JOIN staffing_positions position_record
           ON position_record.id = source_mapping.staffing_position_id
         LEFT JOIN members member_record ON member_record.id = source_row.resolved_member_id
         WHERE source_row.import_id = ?
         ORDER BY source_row.source_row_number ASC, source_row.id ASC`,
    )
      .bind(importId)
      .all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS pending_count FROM assignment_import_missing_observations
         WHERE import_id = ? AND review_status <> 'resolved'`,
    )
      .bind(importId)
      .all(),
  ]);
  const rows = rowsResult.results as unknown as ApplyDbRow[];
  const pendingFindings = (
    missingFindingsResult.results[0] as { pending_count?: number } | undefined
  )?.pending_count;
  const materializedRows = terminalApplyRows(rows);
  if (materializedRows === null || (pendingFindings ?? 0) > 0) {
    return c.json({ error: 'terminal_reconciliation_required' }, 409);
  }
  const canonicalEffectiveOn = parsed.data.canonical_effective_on;
  if (materializedRows.length > 0) {
    if (canonicalEffectiveOn === undefined || !isCalendarDate(canonicalEffectiveOn)) {
      return c.json({ error: 'canonical_effective_date_required' }, 409);
    }
    if (canonicalEffectiveOn < sourceSnapshotAsOf) {
      return c.json({ error: 'canonical_effective_date_before_source_snapshot' }, 409);
    }
  }

  const activeAssignmentsResult = await c.env.DB.prepare(
    `SELECT id, member_id, staffing_position_id, origin_type, status, effective_from, effective_to
       FROM member_assignments WHERE status <> 'cancelled'`,
  ).all();
  const activeAssignments = activeAssignmentsResult.results as unknown as ActiveAssignmentDbRow[];
  const usedTargetPositions = new Set<string>();
  const usedResolvedMemberIds = new Set<number>();
  const endAssignments: EndAssignmentDbRow[] = [];
  for (const row of materializedRows) {
    if (
      row.resolved_member_id === null ||
      row.staffing_position_id === null ||
      row.member_employment_status === null ||
      row.member_rank === null ||
      canonicalEffectiveOn === undefined
    ) {
      return c.json({ error: 'terminal_reconciliation_required' }, 409);
    }
    if (usedTargetPositions.has(row.staffing_position_id)) {
      return c.json({ error: 'duplicate_source_to_canonical_mapping' }, 409);
    }
    usedTargetPositions.add(row.staffing_position_id);
    if (usedResolvedMemberIds.has(row.resolved_member_id)) {
      return c.json({ error: 'duplicate_source_to_canonical_member' }, 409);
    }
    usedResolvedMemberIds.add(row.resolved_member_id);
    const targetAssignments = activeAssignments.filter(
      (assignment) =>
        assignment.staffing_position_id === row.staffing_position_id &&
        activeOn(assignment, canonicalEffectiveOn),
    );
    if (targetAssignments.length > 0) return c.json({ error: 'canonical_state_changed' }, 409);
    const memberAssignments = activeAssignments.filter(
      (assignment) =>
        assignment.member_id === row.resolved_member_id &&
        activeOn(assignment, canonicalEffectiveOn),
    );
    const protectedDifferentAssignment = activeAssignments.some(
      (assignment) =>
        assignment.member_id === row.resolved_member_id &&
        assignment.staffing_position_id !== row.staffing_position_id &&
        (assignment.effective_from > sourceSnapshotAsOf ||
          (assignment.origin_type !== 'TELESTAFF_IMPORT' &&
            assignment.effective_from <= sourceSnapshotAsOf &&
            activeOn(assignment, sourceSnapshotAsOf))),
    );
    if (protectedDifferentAssignment) return c.json({ error: 'canonical_state_changed' }, 409);
    if (row.reconciliation_classification === 'NEW_ASSIGNMENT') {
      if (memberAssignments.length > 0) return c.json({ error: 'canonical_state_changed' }, 409);
    } else if (row.reconciliation_classification === 'MOVED') {
      if (memberAssignments.length !== 1) return c.json({ error: 'canonical_state_changed' }, 409);
      const previous = memberAssignments[0];
      if (previous === undefined) return c.json({ error: 'canonical_state_changed' }, 409);
      endAssignments.push({ ...previous, sourceRowId: row.id });
    }
  }

  const lifecycleEvidence = materializedRows.map((row) =>
    lifecycleEvidenceFor(
      importId,
      parsed.data.expected_reconciliation_revision,
      row,
      canonicalEffectiveOn ?? '',
      endAssignments.find((assignment) => assignment.sourceRowId === row.id),
    ),
  );
  if (lifecycleEvidence.some((evidence) => evidence === null)) {
    return c.json({ error: 'terminal_reconciliation_required' }, 409);
  }
  const evidence = lifecycleEvidence as TeleStaffLifecycleEvidence[];
  const nowMs = Date.now();
  const guards = teleStaffApplyGuards({
    importRecord,
    rows,
    materializedRows,
    endAssignments,
    canonicalEffectiveOn,
    expectedRevision: parsed.data.expected_reconciliation_revision,
  });
  const firstGuard = guards.shift();
  if (firstGuard === undefined) return c.json({ error: 'apply_rejected' }, 409);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE assignment_imports
          SET status = CASE WHEN ${firstGuard.sql} THEN 'approved' ELSE 'invalid_apply_guard' END,
              approved_at = ?, approved_by_member_id = ?
        WHERE id = ? AND status = 'reviewed' AND source_kind = 'official'
          AND reconciliation_revision = ?`,
    ).bind(
      ...firstGuard.bindings,
      nowMs,
      actorId,
      importId,
      parsed.data.expected_reconciliation_revision,
    ),
    ...guards.map((guard) =>
      c.env.DB.prepare(
        `UPDATE assignment_imports
              SET status = 'invalid_apply_guard'
            WHERE id = ? AND status = 'approved' AND NOT ${guard.sql}`,
      ).bind(importId, ...guard.bindings),
    ),
    c.env.DB.prepare(
      `UPDATE assignment_imports
            SET status = 'committed', committed_at = ?
          WHERE id = ? AND status = 'approved' AND reconciliation_revision = ?`,
    ).bind(nowMs, importId, parsed.data.expected_reconciliation_revision),
  ];
  for (const assignment of endAssignments) {
    const effectiveTo =
      assignment.effective_from < (canonicalEffectiveOn ?? '')
        ? previousCalendarDate(canonicalEffectiveOn ?? '')
        : canonicalEffectiveOn;
    const nextStatus =
      assignment.effective_from < (canonicalEffectiveOn ?? '') ? 'ended' : 'superseded';
    statements.push(
      c.env.DB.prepare(
        `UPDATE member_assignments SET status = ?, effective_to = ?, updated_at = ?
           WHERE id = ? AND member_id = ? AND staffing_position_id = ? AND status = ?
             AND effective_from = ? AND effective_to IS ?
             AND EXISTS (
               SELECT 1 FROM assignment_imports apply_import
                WHERE apply_import.id = ? AND apply_import.status = 'committed'
             )`,
      ).bind(
        nextStatus,
        effectiveTo,
        nowMs,
        assignment.id,
        assignment.member_id,
        assignment.staffing_position_id,
        assignment.status,
        assignment.effective_from,
        assignment.effective_to,
        importId,
      ),
    );
  }
  for (const [index, row] of materializedRows.entries()) {
    const lifecycle = evidence[index];
    if (lifecycle === undefined) return c.json({ error: 'terminal_reconciliation_required' }, 409);
    const observationId = `${importId}:observation:${row.id}`;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO assignment_observations
             (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id,
              staffing_position_source_mapping_id, source_a_r_day, normalized_source_topology,
              observed_at, source_observed_at, created_at)
           SELECT ?, source_row.import_id, source_row.id, source_row.resolved_member_id,
                  source_mapping.staffing_position_id, source_row.staffing_position_source_mapping_id,
                  source_row.source_a_r_day, source_row.normalized_source_topology, ?,
                  import_record.source_observed_at, ?
             FROM assignment_import_rows source_row
             JOIN staffing_position_source_mappings source_mapping
               ON source_mapping.id = source_row.staffing_position_source_mapping_id
             JOIN assignment_imports import_record ON import_record.id = source_row.import_id
            WHERE source_row.id = ? AND source_row.import_id = ?
              AND source_row.row_fingerprint = ?
              AND import_record.status = 'committed'`,
      ).bind(observationId, nowMs, nowMs, row.id, importId, row.row_fingerprint),
      c.env.DB.prepare(
        `INSERT INTO member_assignments
             (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id,
              status, effective_from, effective_to, created_at, updated_at)
           SELECT ?, ?, ?, 'TELESTAFF_IMPORT', ?, ?, 'active', ?, NULL, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM assignment_imports apply_import
               WHERE apply_import.id = ? AND apply_import.status = 'committed'
            )`,
      ).bind(
        lifecycle.assignmentId,
        row.resolved_member_id,
        row.staffing_position_id,
        importId,
        observationId,
        canonicalEffectiveOn,
        nowMs,
        nowMs,
        importId,
      ),
      lifecycleStatement(
        c.env.DB,
        row,
        lifecycle,
        canonicalEffectiveOn ?? '',
        actorId,
        nowMs,
        importId,
      ),
    );
  }
  statements.push(
    teleStaffApplyAuditStatement(c.env.DB, {
      importId,
      revision: parsed.data.expected_reconciliation_revision,
      actorId,
      sourceSnapshotAsOf,
      canonicalEffectiveOn,
      evidence,
      endedAssignments: endAssignments,
      nowMs,
    }),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    // Preserve the public fail-closed response while retaining the D1 rejection
    // in the staging Worker log for release-captain diagnosis.
    console.error('telestaff apply failed', error);
    return c.json({ error: 'apply_rejected' }, 409);
  }
  const committed = await loadImportSummary(c.env.DB, importId);
  if (committed === undefined || committed.status !== 'committed') {
    return c.json({ error: 'apply_rejected' }, 409);
  }
  return c.json({
    import: mapImport(committed),
    canonicalMutation: {
      createdObservations: materializedRows.length,
      createdAssignments: materializedRows.length,
      endedAssignments: endAssignments.length,
      canonicalEffectiveOn: canonicalEffectiveOn ?? null,
    },
  });
});

/**
 * Designates one complete, official import as the bid year's authoritative
 * staffing baseline.  This is deliberately a Hub-admin-only lifecycle action:
 * local staging admins and direct D1 callers cannot manufacture acceptance.
 */
router.post('/imports/:importId/baseline-acceptance', requireStepUpAuth(), async (c) => {
  const importId = c.req.param('importId');
  if (!isOpaqueId(importId)) return c.json({ error: 'invalid_import_id' }, 400);
  const raw = await c.req.json().catch(() => null);
  const parsed = BaselineAcceptanceRequestSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  const acceptanceId = c.req.header('Idempotency-Key');
  if (acceptanceId === undefined || !isOpaqueId(acceptanceId)) {
    return c.json({ error: 'idempotency_key_required' }, 400);
  }
  const actorId = actorMemberId(c.get('claims'));
  if (actorId === null) return c.json({ error: 'operator_identity_required' }, 403);

  const accepted = await acceptAuthoritativeStaffingBaseline(c.env.DB, getDb(c.env.DB), {
    acceptanceId,
    bidYear: parsed.data.bid_year,
    importId,
    actorMemberId: actorId,
    reason: parsed.data.reason,
    acceptedAtMs: Date.now(),
  });
  if (!accepted.ok) {
    const status = accepted.code === 'INVALID_ACCEPTANCE_REQUEST' ? 400 : 409;
    return c.json({ error: accepted.code.toLowerCase(), baseline: accepted.baseline }, status);
  }
  return c.json(accepted, 201);
});

export default router;
