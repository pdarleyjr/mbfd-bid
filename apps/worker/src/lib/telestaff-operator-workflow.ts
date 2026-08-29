import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import {
  type TeleStaffAssignmentsHtmlParseResult,
  parseTeleStaffAssignmentsHtml,
} from './telestaff-assignment-html.js';
import type {
  TeleStaffSourceKind,
  TeleStaffSourceObservationTimeBasis,
} from './telestaff-assignment-import.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const encoder = new TextEncoder();

export interface TeleStaffSourceObservationTime {
  /** Epoch milliseconds from trustworthy source metadata or an administrator confirmation. */
  sourceObservedAt: number | null;
  sourceObservationTimeBasis: TeleStaffSourceObservationTimeBasis;
}

export type TeleStaffSourceObservationTimeValidation =
  | ({ ok: true } & TeleStaffSourceObservationTime)
  | {
      ok: false;
      code: 'INVALID_SOURCE_OBSERVATION_TIME' | 'SOURCE_OBSERVATION_DATE_MISMATCH';
    };

export type TeleStaffOperatorPreviewResult =
  | {
      ok: true;
      sourceKind: TeleStaffSourceKind;
      sourceSnapshotAsOf: string;
      sourceObservedAt: number | null;
      sourceObservationTimeBasis: TeleStaffSourceObservationTimeBasis;
      sourceFormat: 'TELSTAFF_ASSIGNMENTS_HTML_V1';
      parserVersion: string;
      inputRowCount: number;
      normalizedDataRowCount: number;
      uniqueEmployeeCount: number;
      reportRowCount: number;
      structuralRowCount: number;
      incompleteTopologyCount: number;
      missingSourceARDayCount: number;
      workflowState: 'PREVIEW_REQUIRES_STAGE';
    }
  | {
      ok: false;
      code: 'INVALID_SOURCE_SNAPSHOT_AS_OF' | 'INVALID_SOURCE_KIND' | 'SOURCE_PARSE_REJECTED';
    };

export type TeleStaffReconciliationClassification =
  | 'UNCHANGED'
  | 'MOVED'
  | 'NEW_ASSIGNMENT'
  | 'NEW_POSITION'
  | 'UNKNOWN_EMPLOYEE'
  | 'AMBIGUOUS_MAPPING'
  | 'INCOMPLETE_TOPOLOGY';

export type TeleStaffReviewDecision =
  | 'accept_observation'
  | 'keep_current'
  | 'defer_new_position'
  | 'reject_source_row'
  | 'retain_incomplete_source_row';

export interface TeleStaffReconciliationResult {
  ok: true;
  importId: string;
  reconciliationRevision: number;
  counts: Record<TeleStaffReconciliationClassification, number>;
}

interface ImportRecord {
  id: string;
  source_system: string;
  source_kind: TeleStaffSourceKind | 'legacy_unclassified';
  status: 'staged' | 'reviewed' | 'approved' | 'committed' | 'rejected';
  source_snapshot_as_of: string | null;
  reconciliation_revision: number;
}

interface SourceRowRecord {
  id: string;
  member_reference_hmac: string | null;
  normalized_source_topology: string;
  source_topology_completeness: 'complete' | 'incomplete';
}

interface MemberRecord {
  id: number;
  employee_id: string;
}

interface SourceMappingRecord {
  id: string;
  staffing_position_id: string;
  source_locator: string;
}

interface AssignmentRecord {
  id: string;
  member_id: number;
  staffing_position_id: string;
  origin_type: string;
  // A future-effective end/supersession remains canonical occupancy until its
  // effective_to boundary. Only a cancelled record is non-canonical.
  status: 'planned' | 'active' | 'superseded' | 'cancelled' | 'ended';
  effective_from: string;
  effective_to: string | null;
}

interface ReconciledRow {
  id: string;
  resolvedMemberId: number | null;
  mappingId: string | null;
  classification: TeleStaffReconciliationClassification;
  disposition: 'unchanged' | 'moved' | 'new_combination' | 'unknown_employee' | 'ambiguous_mapping';
  reviewStatus: 'not_required' | 'pending';
}

export interface TeleStaffReviewMutation {
  reviewStatus: 'approved' | 'rejected';
  resolutionAction:
    | 'APPLY_OBSERVATION'
    | 'REJECT_SOURCE_ROW'
    | 'DEFER_NEW_POSITION'
    | 'RETAIN_UNMATERIALIZED_SOURCE_ROW';
  reasonCode: string;
}

function isSourceKind(value: string): value is TeleStaffSourceKind {
  return value === 'official' || value === 'synthetic_test';
}

export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSourceObservationTimeBasis(value: string): value is TeleStaffSourceObservationTimeBasis {
  return (
    value === 'date_only' || value === 'source_metadata' || value === 'administrator_confirmed'
  );
}

/**
 * Validates temporal provenance independently from canonical effectivity. The
 * source's local calendar date must agree with the explicitly supplied source
 * snapshot date; UTC conversion is retained only after that evidence check.
 */
export function validateTeleStaffSourceObservationTime(input: {
  sourceSnapshotAsOf: string;
  sourceObservedAt: string | null;
  sourceObservationTimeBasis: string | null;
}): TeleStaffSourceObservationTimeValidation {
  const basis = input.sourceObservationTimeBasis ?? 'date_only';
  const sourceObservedAt = input.sourceObservedAt;
  if (!isSourceObservationTimeBasis(basis)) {
    return { ok: false, code: 'INVALID_SOURCE_OBSERVATION_TIME' };
  }
  if (basis === 'date_only') {
    if (sourceObservedAt !== null) return { ok: false, code: 'INVALID_SOURCE_OBSERVATION_TIME' };
    return { ok: true, sourceObservedAt: null, sourceObservationTimeBasis: basis };
  }
  if (sourceObservedAt === null) return { ok: false, code: 'INVALID_SOURCE_OBSERVATION_TIME' };
  const parts = RFC3339_TIMESTAMP.exec(sourceObservedAt);
  if (parts === null || !isCalendarDate(parts[1] ?? '')) {
    return { ok: false, code: 'INVALID_SOURCE_OBSERVATION_TIME' };
  }
  const hour = Number(parts[2]);
  const minute = Number(parts[3]);
  const second = Number(parts[4]);
  const offset = parts[5] ?? '';
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return { ok: false, code: 'INVALID_SOURCE_OBSERVATION_TIME' };
  }
  if (parts[1] !== input.sourceSnapshotAsOf) {
    return { ok: false, code: 'SOURCE_OBSERVATION_DATE_MISMATCH' };
  }
  const epochMs = Date.parse(sourceObservedAt);
  if (!Number.isSafeInteger(epochMs)) {
    return { ok: false, code: 'INVALID_SOURCE_OBSERVATION_TIME' };
  }
  return { ok: true, sourceObservedAt: epochMs, sourceObservationTimeBasis: basis };
}

/**
 * The dedicated key is intentionally separate from JWT signing material: source
 * references must remain stable across JWT rotation and are never reversible.
 */
export function hasUsableTeleStaffHmacKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 32;
}

function keyedDigest(key: string, purpose: string, value: string): string {
  return bytesToHex(hmac(sha256, encoder.encode(key), encoder.encode(`${purpose}\u0000${value}`)));
}

export function makeTeleStaffHmacFunctions(key: string): {
  hmacEmployeeReference: (employeeId: string) => Promise<string>;
  hmacRowFingerprint: (canonicalSourceRow: string) => Promise<string>;
} {
  return {
    hmacEmployeeReference: async (employeeId) =>
      keyedDigest(key, 'mbfd-bid/telestaff/member-reference/v1', employeeId),
    hmacRowFingerprint: async (canonicalSourceRow) =>
      keyedDigest(key, 'mbfd-bid/telestaff/row-fingerprint/v1', canonicalSourceRow),
  };
}

/**
 * Parses source bytes only for this request and returns aggregate evidence. No
 * parsed name, Emp ID, or source row value crosses this function boundary.
 */
export async function createTeleStaffOperatorPreview(
  source: Uint8Array,
  sourceSnapshotAsOf: string,
  sourceKind: string,
  sourceObservationTime: TeleStaffSourceObservationTime = {
    sourceObservedAt: null,
    sourceObservationTimeBasis: 'date_only',
  },
): Promise<TeleStaffOperatorPreviewResult> {
  if (!isCalendarDate(sourceSnapshotAsOf)) {
    return { ok: false, code: 'INVALID_SOURCE_SNAPSHOT_AS_OF' };
  }
  if (!isSourceKind(sourceKind)) return { ok: false, code: 'INVALID_SOURCE_KIND' };

  let parsed: TeleStaffAssignmentsHtmlParseResult;
  try {
    parsed = await parseTeleStaffAssignmentsHtml(source);
  } catch {
    return { ok: false, code: 'SOURCE_PARSE_REJECTED' };
  }
  if (!parsed.ok) return { ok: false, code: 'SOURCE_PARSE_REJECTED' };

  return {
    ok: true,
    sourceKind,
    sourceSnapshotAsOf,
    sourceObservedAt: sourceObservationTime.sourceObservedAt,
    sourceObservationTimeBasis: sourceObservationTime.sourceObservationTimeBasis,
    sourceFormat: parsed.sourceFormat,
    parserVersion: parsed.parserVersion,
    inputRowCount: parsed.inputRowCount,
    normalizedDataRowCount: parsed.normalizedDataRowCount,
    uniqueEmployeeCount: parsed.uniqueEmployeeCount,
    reportRowCount: parsed.reportRowCount,
    structuralRowCount: parsed.structuralRowCount,
    incompleteTopologyCount: parsed.rows.filter((row) => row.topologyCompleteness === 'incomplete')
      .length,
    missingSourceARDayCount: parsed.rows.filter((row) => row.sourceARDay === null).length,
    workflowState: 'PREVIEW_REQUIRES_STAGE',
  };
}

function assignmentActiveOn(assignment: AssignmentRecord, asOf: string): boolean {
  return (
    assignment.effective_from <= asOf &&
    (assignment.effective_to === null || assignment.effective_to >= asOf)
  );
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const itemKey = key(item);
    const existing = grouped.get(itemKey);
    if (existing === undefined) grouped.set(itemKey, [item]);
    else existing.push(item);
  }
  return grouped;
}

function emptyCounts(): Record<TeleStaffReconciliationClassification, number> {
  return {
    UNCHANGED: 0,
    MOVED: 0,
    NEW_ASSIGNMENT: 0,
    NEW_POSITION: 0,
    UNKNOWN_EMPLOYEE: 0,
    AMBIGUOUS_MAPPING: 0,
    INCOMPLETE_TOPOLOGY: 0,
  };
}

function unresolvedRow(
  classification: 'UNKNOWN_EMPLOYEE' | 'AMBIGUOUS_MAPPING' | 'INCOMPLETE_TOPOLOGY',
  memberId: number | null = null,
): ReconciledRow {
  return {
    id: '',
    resolvedMemberId: memberId,
    mappingId: null,
    classification,
    disposition: classification === 'UNKNOWN_EMPLOYEE' ? 'unknown_employee' : 'ambiguous_mapping',
    reviewStatus: 'pending',
  };
}

function classifyOfficialRow(
  row: SourceRowRecord,
  memberId: number | null,
  mappingsByLocator: ReadonlyMap<string, SourceMappingRecord[]>,
  assignmentsByMember: ReadonlyMap<number, AssignmentRecord[]>,
  assignmentsByPosition: ReadonlyMap<string, AssignmentRecord[]>,
  sourceSnapshotAsOf: string,
): ReconciledRow {
  if (row.source_topology_completeness === 'incomplete') {
    return { ...unresolvedRow('INCOMPLETE_TOPOLOGY', memberId), id: row.id };
  }
  if (memberId === null) return { ...unresolvedRow('UNKNOWN_EMPLOYEE'), id: row.id };

  const mappingCandidates = mappingsByLocator.get(row.normalized_source_topology) ?? [];
  if (mappingCandidates.length === 0) {
    return {
      id: row.id,
      resolvedMemberId: memberId,
      mappingId: null,
      classification: 'NEW_POSITION',
      disposition: 'ambiguous_mapping',
      reviewStatus: 'pending',
    };
  }
  if (mappingCandidates.length !== 1) {
    return { ...unresolvedRow('AMBIGUOUS_MAPPING', memberId), id: row.id };
  }

  const mapping = mappingCandidates[0];
  if (mapping === undefined) return { ...unresolvedRow('AMBIGUOUS_MAPPING', memberId), id: row.id };
  const targetAssignments = (assignmentsByPosition.get(mapping.staffing_position_id) ?? []).filter(
    (assignment) => assignmentActiveOn(assignment, sourceSnapshotAsOf),
  );
  const memberAssignments = assignmentsByMember.get(memberId) ?? [];
  const assignmentAtSource = memberAssignments.filter((assignment) =>
    assignmentActiveOn(assignment, sourceSnapshotAsOf),
  );
  const newerDifferentAssignment = memberAssignments.find(
    (assignment) =>
      assignment.effective_from > sourceSnapshotAsOf &&
      assignment.staffing_position_id !== mapping.staffing_position_id,
  );

  if (targetAssignments.length > 1) {
    return { ...unresolvedRow('AMBIGUOUS_MAPPING', memberId), id: row.id };
  }
  const targetAssignment = targetAssignments[0];
  if (targetAssignment?.member_id === memberId) {
    return {
      id: row.id,
      resolvedMemberId: memberId,
      mappingId: mapping.id,
      classification: 'UNCHANGED',
      disposition: 'unchanged',
      reviewStatus: 'not_required',
    };
  }
  if (targetAssignment !== undefined) {
    return { ...unresolvedRow('AMBIGUOUS_MAPPING', memberId), id: row.id };
  }
  if (newerDifferentAssignment !== undefined || assignmentAtSource.length > 0) {
    return {
      id: row.id,
      resolvedMemberId: memberId,
      mappingId: mapping.id,
      classification: 'MOVED',
      disposition: 'moved',
      reviewStatus: 'pending',
    };
  }
  return {
    id: row.id,
    resolvedMemberId: memberId,
    mappingId: mapping.id,
    classification: 'NEW_ASSIGNMENT',
    disposition: 'new_combination',
    reviewStatus: 'pending',
  };
}

/**
 * Resolves only deterministic, pre-approved canonical context. It never creates
 * a slot/mapping, materializes an assignment, or returns source personnel data.
 * A missing, ambiguous, or synthetic source remains in review-required state.
 */
export async function reconcileStagedTeleStaffImport(
  d1: D1Database,
  options: { importId: string; hmacKey: string },
): Promise<TeleStaffReconciliationResult | { ok: false; code: string }> {
  const importResult = await d1
    .prepare(
      `SELECT id, source_system, source_kind, status, source_snapshot_as_of, reconciliation_revision
       FROM assignment_imports WHERE id = ?`,
    )
    .bind(options.importId)
    .all();
  const importRecord = importResult.results[0] as unknown as ImportRecord | undefined;
  if (importRecord === undefined) return { ok: false, code: 'IMPORT_NOT_FOUND' };
  if (importRecord.status !== 'staged' && importRecord.status !== 'reviewed') {
    return { ok: false, code: 'IMPORT_NOT_RECONCILABLE' };
  }
  if (
    importRecord.source_system !== 'telestaff' ||
    importRecord.source_snapshot_as_of === null ||
    !isCalendarDate(importRecord.source_snapshot_as_of)
  ) {
    return { ok: false, code: 'INVALID_IMPORT_MANIFEST' };
  }
  if (!hasUsableTeleStaffHmacKey(options.hmacKey)) {
    return { ok: false, code: 'TELESTAFF_CONFIGURATION_UNAVAILABLE' };
  }

  const sourceRowsResult = await d1
    .prepare(
      `SELECT id, member_reference_hmac, normalized_source_topology, source_topology_completeness
       FROM assignment_import_rows WHERE import_id = ? ORDER BY source_row_number ASC, id ASC`,
    )
    .bind(options.importId)
    .all();
  const sourceRows = sourceRowsResult.results as unknown as SourceRowRecord[];
  const counts = emptyCounts();

  if (importRecord.source_kind === 'synthetic_test') {
    for (const row of sourceRows) {
      const classification =
        row.source_topology_completeness === 'incomplete'
          ? 'INCOMPLETE_TOPOLOGY'
          : 'AMBIGUOUS_MAPPING';
      counts[classification] += 1;
      await d1
        .prepare(
          `UPDATE assignment_import_rows
             SET resolved_member_id = NULL,
                 staffing_position_source_mapping_id = NULL,
                 disposition = ?,
                 reconciliation_classification = ?,
                 review_status = 'pending',
                 resolution_action = NULL,
                 reviewed_at = NULL,
                 reviewed_by_member_id = NULL,
                 resolution_reason = NULL
           WHERE id = ? AND import_id = ?`,
        )
        .bind('ambiguous_mapping', classification, row.id, options.importId)
        .run();
    }
  } else if (importRecord.source_kind === 'official') {
    const [membersResult, mappingsResult, assignmentsResult] = await Promise.all([
      d1.prepare('SELECT id, employee_id FROM members').all(),
      d1
        .prepare(
          `SELECT mapping.id, mapping.staffing_position_id, mapping.source_locator
           FROM staffing_position_source_mappings mapping
           JOIN staffing_positions position_record
             ON position_record.id = mapping.staffing_position_id
           WHERE mapping.source_system = 'telestaff'
             AND mapping.effective_from <= ?
             AND (mapping.effective_to IS NULL OR mapping.effective_to >= ?)
             AND position_record.review_status = 'approved'
             AND (position_record.active_from IS NULL OR position_record.active_from <= ?)
             AND (position_record.active_to IS NULL OR position_record.active_to >= ?)`,
        )
        .bind(
          importRecord.source_snapshot_as_of,
          importRecord.source_snapshot_as_of,
          importRecord.source_snapshot_as_of,
          importRecord.source_snapshot_as_of,
        )
        .all(),
      d1
        .prepare(
          `SELECT id, member_id, staffing_position_id, origin_type, status, effective_from, effective_to
           FROM member_assignments WHERE status <> 'cancelled'`,
        )
        .all(),
    ]);
    const members = membersResult.results as unknown as MemberRecord[];
    const mappings = mappingsResult.results as unknown as SourceMappingRecord[];
    const assignments = assignmentsResult.results as unknown as AssignmentRecord[];
    const memberCandidatesByHmac = groupBy(members, (member) =>
      keyedDigest(options.hmacKey, 'mbfd-bid/telestaff/member-reference/v1', member.employee_id),
    );
    const mappingsByLocator = groupBy(mappings, (mapping) => mapping.source_locator);
    const assignmentsByMember = groupBy(assignments, (assignment) => assignment.member_id);
    const assignmentsByPosition = groupBy(
      assignments,
      (assignment) => assignment.staffing_position_id,
    );

    for (const row of sourceRows) {
      const candidates =
        row.member_reference_hmac === null
          ? []
          : (memberCandidatesByHmac.get(row.member_reference_hmac) ?? []);
      const resolvedMemberId = candidates.length === 1 ? (candidates[0]?.id ?? null) : null;
      const reconciled = classifyOfficialRow(
        row,
        resolvedMemberId,
        mappingsByLocator,
        assignmentsByMember,
        assignmentsByPosition,
        importRecord.source_snapshot_as_of,
      );
      counts[reconciled.classification] += 1;
      await d1
        .prepare(
          `UPDATE assignment_import_rows
             SET resolved_member_id = ?,
                 staffing_position_source_mapping_id = ?,
                 disposition = ?,
                 reconciliation_classification = ?,
                 review_status = ?,
                 resolution_action = NULL,
                 reviewed_at = NULL,
                 reviewed_by_member_id = NULL,
                 resolution_reason = NULL
           WHERE id = ? AND import_id = ?`,
        )
        .bind(
          reconciled.resolvedMemberId,
          reconciled.mappingId,
          reconciled.disposition,
          reconciled.classification,
          reconciled.reviewStatus,
          reconciled.id,
          options.importId,
        )
        .run();
    }
  } else {
    return { ok: false, code: 'UNSUPPORTED_SOURCE_KIND' };
  }

  if (importRecord.status === 'staged') {
    await d1
      .prepare(
        "UPDATE assignment_imports SET status = 'reviewed' WHERE id = ? AND status = 'staged'",
      )
      .bind(options.importId)
      .run();
  }
  const finalResult = await d1
    .prepare('SELECT reconciliation_revision FROM assignment_imports WHERE id = ?')
    .bind(options.importId)
    .all();
  const finalRecord = finalResult.results[0] as { reconciliation_revision: number } | undefined;
  if (finalRecord === undefined) return { ok: false, code: 'IMPORT_NOT_FOUND' };
  return {
    ok: true,
    importId: options.importId,
    reconciliationRevision: finalRecord.reconciliation_revision,
    counts,
  };
}

export function reviewMutationFor(
  classification: string | null,
  decision: TeleStaffReviewDecision,
  isCurrentRecordNewer: boolean,
): TeleStaffReviewMutation | null {
  if (
    decision === 'accept_observation' &&
    !isCurrentRecordNewer &&
    (classification === 'MOVED' || classification === 'NEW_ASSIGNMENT')
  ) {
    return {
      reviewStatus: 'approved',
      resolutionAction: 'APPLY_OBSERVATION',
      reasonCode: 'ACCEPT_TELESTAFF_OBSERVATION',
    };
  }
  if (decision === 'keep_current' && classification === 'MOVED' && isCurrentRecordNewer) {
    return {
      reviewStatus: 'rejected',
      resolutionAction: 'REJECT_SOURCE_ROW',
      // member_assignments has no approval provenance. Preserve the newer
      // canonical record without falsely representing it as approved.
      reasonCode: 'KEEP_CURRENT_PROTECTED_CANONICAL_ASSIGNMENT',
    };
  }
  if (decision === 'defer_new_position' && classification === 'NEW_POSITION') {
    return {
      reviewStatus: 'approved',
      resolutionAction: 'DEFER_NEW_POSITION',
      reasonCode: 'DEFER_NEW_TOPOLOGY',
    };
  }
  if (decision === 'retain_incomplete_source_row' && classification === 'INCOMPLETE_TOPOLOGY') {
    return {
      reviewStatus: 'approved',
      resolutionAction: 'RETAIN_UNMATERIALIZED_SOURCE_ROW',
      reasonCode: 'RETAIN_INCOMPLETE_SOURCE_ROW',
    };
  }
  if (
    decision === 'reject_source_row' &&
    (classification === 'UNKNOWN_EMPLOYEE' ||
      classification === 'AMBIGUOUS_MAPPING' ||
      classification === 'MOVED' ||
      classification === 'NEW_ASSIGNMENT' ||
      classification === 'NEW_POSITION' ||
      classification === 'INCOMPLETE_TOPOLOGY')
  ) {
    return {
      reviewStatus: 'rejected',
      resolutionAction: 'REJECT_SOURCE_ROW',
      reasonCode: 'REJECT_SOURCE_ROW',
    };
  }
  return null;
}

export function reviewStateFor(input: {
  classification: string | null;
  isCurrentRecordNewer: boolean;
}): string {
  if (input.classification === 'MOVED' && input.isCurrentRecordNewer) {
    return 'CURRENT_RECORD_PROTECTED_FROM_SOURCE_OBSERVATION';
  }
  switch (input.classification) {
    case 'UNCHANGED':
      return 'NO_ACTION_REQUIRED';
    case 'MOVED':
      return 'REVIEW_ACCEPT_TELESTAFF_OR_KEEP_CURRENT';
    case 'NEW_ASSIGNMENT':
      return 'REVIEW_NEW_ASSIGNMENT';
    case 'NEW_POSITION':
      return 'NEW_TOPOLOGY_REVIEW_REQUIRED';
    case 'UNKNOWN_EMPLOYEE':
      return 'UNKNOWN_EMPLOYEE_REVIEW_REQUIRED';
    case 'AMBIGUOUS_MAPPING':
      return 'AMBIGUOUS_MAPPING_REVIEW_REQUIRED';
    case 'INCOMPLETE_TOPOLOGY':
      return 'INCOMPLETE_TOPOLOGY_REVIEW_REQUIRED';
    default:
      return 'RECONCILIATION_REVIEW_REQUIRED';
  }
}

export function allowedReviewActionsFor(input: {
  classification: string | null;
  isCurrentRecordNewer: boolean;
}): TeleStaffReviewDecision[] {
  switch (input.classification) {
    case 'MOVED':
      return input.isCurrentRecordNewer
        ? ['keep_current', 'reject_source_row']
        : ['accept_observation', 'reject_source_row'];
    case 'NEW_ASSIGNMENT':
      return ['accept_observation', 'reject_source_row'];
    case 'NEW_POSITION':
      return ['defer_new_position', 'reject_source_row'];
    case 'INCOMPLETE_TOPOLOGY':
      return ['retain_incomplete_source_row', 'reject_source_row'];
    case 'UNKNOWN_EMPLOYEE':
    case 'AMBIGUOUS_MAPPING':
      return ['reject_source_row'];
    default:
      return [];
  }
}
