import { and, eq } from 'drizzle-orm';

import type { DB } from '../db/index.js';
import {
  assignmentImportMissingObservations,
  assignmentImportRows,
  assignmentImports,
  assignmentObservations,
  bidYearStaffingBaselines,
  memberAssignments,
  staffingPositions,
} from '../db/schema.js';

const SUPPORTED_SOURCE_FORMATS = new Set([
  'TELSTAFF_ASSIGNMENTS_LEGACY_V1',
  'TELSTAFF_ASSIGNMENTS_HTML_V1',
]);

export type AuthoritativeStaffingBaselineStatus = 'PASS' | 'BLOCKED';

/**
 * Aggregate-only proof that a designated source manifest is complete. It
 * contains no raw source names, Emp IDs, HMAC values, row fingerprints, or
 * source topology values.
 */
export interface TeleStaffImportCompleteness {
  status: AuthoritativeStaffingBaselineStatus;
  importId: string | null;
  sourceSystem: string | null;
  sourceFormat: string | null;
  parserVersion: string | null;
  sourceKind: 'official' | 'synthetic_test' | 'legacy_unclassified' | null;
  sourceHashPresent: boolean;
  /** Digest only; never raw source material. */
  sourceHash: string | null;
  sourceManifestIntact: boolean;
  inputRowCount: number;
  normalizedDataRowCount: number | null;
  uniqueEmployeeCount: number | null;
  reportRowCount: number;
  structuralRowCount: number;
  sourceRowCount: number;
  resolvedRowCount: number;
  reviewedExceptionCount: number;
  incompleteTopologyCount: number;
  observationCount: number;
  canonicalAssignmentCount: number;
  missingObservations: number;
  unresolvedIncompleteTopology: number;
  unreviewedMappings: number;
  unresolvedMissingObservationFindings: number;
  unknownEmployees: number;
  ambiguousMappings: number;
  /** Source rows that do not yet have a valid terminal disposition. */
  unresolvedRows: number;
  blockingCodes: readonly string[];
}

export interface AuthoritativeStaffingBaselineEvaluation extends TeleStaffImportCompleteness {
  bidYear: number;
  baselineAcceptanceId: string | null;
  baselineAcceptedAtMs: number | null;
}

function defaultCompleteness(importId: string | null = null): TeleStaffImportCompleteness {
  return {
    status: 'BLOCKED',
    importId,
    sourceSystem: null,
    sourceFormat: null,
    parserVersion: null,
    sourceKind: null,
    sourceHashPresent: false,
    sourceHash: null,
    sourceManifestIntact: false,
    inputRowCount: 0,
    normalizedDataRowCount: null,
    uniqueEmployeeCount: null,
    reportRowCount: 0,
    structuralRowCount: 0,
    sourceRowCount: 0,
    resolvedRowCount: 0,
    reviewedExceptionCount: 0,
    incompleteTopologyCount: 0,
    observationCount: 0,
    canonicalAssignmentCount: 0,
    missingObservations: 0,
    unresolvedIncompleteTopology: 0,
    unreviewedMappings: 0,
    unresolvedMissingObservationFindings: 0,
    unknownEmployees: 0,
    ambiguousMappings: 0,
    unresolvedRows: 0,
    blockingCodes: [],
  };
}

function addCode(codes: Set<string>, code: string): void {
  codes.add(code);
}

function hasNonBlankText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

/** Accept only a real ISO calendar date when an optional source snapshot is supplied. */
function isValidSourceSnapshotDate(value: string | null): boolean {
  if (value === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function isStructuredTopologyValid(
  value: string,
  completeness: 'complete' | 'incomplete',
): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const topology = parsed as Record<string, unknown>;
    if (topology.v !== 1) return false;
    const fields = ['shift', 'division', 'station', 'unit', 'position'] as const;
    const values = fields.map((field) => topology[field]);
    if (
      !values.every((field) => field === null || (typeof field === 'string' && field.trim() !== ''))
    ) {
      return false;
    }
    return completeness === 'complete'
      ? values.every((field) => typeof field === 'string')
      : values.some((field) => field === null);
  } catch {
    return false;
  }
}

/**
 * Re-evaluates every persisted source row. This never chooses an arbitrary
 * historic import: callers that need a publish gate must call the bid-year
 * evaluator below.
 */
export async function evaluateTeleStaffImportCompleteness(
  db: DB,
  importId: string,
): Promise<TeleStaffImportCompleteness> {
  const importRecord = await db
    .select({
      id: assignmentImports.id,
      sourceSystem: assignmentImports.sourceSystem,
      sourceHash: assignmentImports.sourceHash,
      sourceFormat: assignmentImports.sourceFormat,
      parserVersion: assignmentImports.parserVersion,
      sourceKind: assignmentImports.sourceKind,
      status: assignmentImports.status,
      inputRowCount: assignmentImports.inputRowCount,
      normalizedDataRowCount: assignmentImports.normalizedDataRowCount,
      uniqueEmployeeCount: assignmentImports.uniqueEmployeeCount,
      reportRowCount: assignmentImports.reportRowCount,
      structuralRowCount: assignmentImports.structuralRowCount,
      sourceSnapshotAsOf: assignmentImports.sourceSnapshotAsOf,
    })
    .from(assignmentImports)
    .where(eq(assignmentImports.id, importId))
    .get();

  if (importRecord === undefined) {
    const missing = defaultCompleteness(importId);
    return { ...missing, blockingCodes: ['AUTHORITATIVE_IMPORT_NOT_FOUND'] };
  }

  const [rows, observations, assignments, missingFindings] = await Promise.all([
    db
      .select({
        id: assignmentImportRows.id,
        sourceRowNumber: assignmentImportRows.sourceRowNumber,
        rowFingerprint: assignmentImportRows.rowFingerprint,
        memberReferenceHmac: assignmentImportRows.memberReferenceHmac,
        resolvedMemberId: assignmentImportRows.resolvedMemberId,
        staffingPositionSourceMappingId: assignmentImportRows.staffingPositionSourceMappingId,
        normalizedSourceTopology: assignmentImportRows.normalizedSourceTopology,
        sourceTopologyCompleteness: assignmentImportRows.sourceTopologyCompleteness,
        classification: assignmentImportRows.reconciliationClassification,
        reviewStatus: assignmentImportRows.reviewStatus,
        resolutionAction: assignmentImportRows.resolutionAction,
      })
      .from(assignmentImportRows)
      .where(eq(assignmentImportRows.importId, importId))
      .all(),
    db
      .select({
        id: assignmentObservations.id,
        sourceRowId: assignmentObservations.assignmentImportRowId,
      })
      .from(assignmentObservations)
      .where(eq(assignmentObservations.assignmentImportId, importId))
      .all(),
    db
      .select({
        sourceObservationId: memberAssignments.sourceObservationId,
        originType: memberAssignments.originType,
        status: memberAssignments.status,
        staffingReviewStatus: staffingPositions.reviewStatus,
      })
      .from(memberAssignments)
      .innerJoin(
        assignmentObservations,
        eq(memberAssignments.sourceObservationId, assignmentObservations.id),
      )
      .innerJoin(staffingPositions, eq(memberAssignments.staffingPositionId, staffingPositions.id))
      .where(eq(assignmentObservations.assignmentImportId, importId))
      .all(),
    db
      .select({ reviewStatus: assignmentImportMissingObservations.reviewStatus })
      .from(assignmentImportMissingObservations)
      .where(eq(assignmentImportMissingObservations.importId, importId))
      .all(),
  ]);

  const codes = new Set<string>();
  if (importRecord.sourceSystem !== 'telestaff') addCode(codes, 'UNSUPPORTED_SOURCE_SYSTEM');
  if (!SUPPORTED_SOURCE_FORMATS.has(importRecord.sourceFormat ?? '')) {
    addCode(codes, 'UNSUPPORTED_SOURCE_FORMAT');
  }
  if (!hasNonBlankText(importRecord.parserVersion)) addCode(codes, 'MISSING_PARSER_PROVENANCE');
  if (!/^[a-f0-9]{64}$/i.test(importRecord.sourceHash))
    addCode(codes, 'MISSING_OR_INVALID_SOURCE_HASH');
  if (!isValidSourceSnapshotDate(importRecord.sourceSnapshotAsOf)) {
    addCode(codes, 'INVALID_SOURCE_SNAPSHOT_AS_OF');
  }
  if (importRecord.status !== 'committed') addCode(codes, 'IMPORT_NOT_COMMITTED');
  if (importRecord.normalizedDataRowCount === null || importRecord.uniqueEmployeeCount === null) {
    addCode(codes, 'MISSING_SOURCE_MANIFEST_ACCOUNTING');
  }
  if (
    importRecord.structuralRowCount < 0 ||
    importRecord.reportRowCount !==
      (importRecord.normalizedDataRowCount ?? 0) + importRecord.structuralRowCount
  ) {
    addCode(codes, 'REPORT_ROW_ACCOUNTING_FAILED');
  }

  const sourceRowNumbers = new Set<number>();
  const fingerprints = new Set<string>();
  const employeeHmacs = new Set<string>();
  let missingIdentityCount = 0;
  for (const row of rows) {
    if (sourceRowNumbers.has(row.sourceRowNumber)) addCode(codes, 'DUPLICATE_SOURCE_ROW_NUMBER');
    sourceRowNumbers.add(row.sourceRowNumber);
    if (fingerprints.has(row.rowFingerprint)) addCode(codes, 'DUPLICATE_SOURCE_ROW_FINGERPRINT');
    fingerprints.add(row.rowFingerprint);
    if (row.memberReferenceHmac === null) {
      missingIdentityCount += 1;
    } else {
      if (employeeHmacs.has(row.memberReferenceHmac))
        addCode(codes, 'DUPLICATE_SOURCE_EMPLOYEE_IDENTITY');
      employeeHmacs.add(row.memberReferenceHmac);
    }
  }

  const manifestCountsMatch =
    importRecord.normalizedDataRowCount !== null &&
    importRecord.uniqueEmployeeCount !== null &&
    importRecord.inputRowCount === importRecord.normalizedDataRowCount &&
    importRecord.inputRowCount === rows.length &&
    importRecord.uniqueEmployeeCount === employeeHmacs.size &&
    importRecord.reportRowCount ===
      importRecord.normalizedDataRowCount + importRecord.structuralRowCount &&
    importRecord.structuralRowCount >= 0 &&
    missingIdentityCount === 0 &&
    rows.length > 0;
  if (
    importRecord.normalizedDataRowCount !== null &&
    (importRecord.inputRowCount !== importRecord.normalizedDataRowCount ||
      importRecord.inputRowCount !== rows.length)
  ) {
    addCode(codes, 'SOURCE_ROW_COUNT_MISMATCH');
  }
  if (
    importRecord.uniqueEmployeeCount !== null &&
    (importRecord.uniqueEmployeeCount !== employeeHmacs.size ||
      importRecord.uniqueEmployeeCount !== importRecord.inputRowCount ||
      missingIdentityCount > 0)
  ) {
    addCode(codes, 'SOURCE_IDENTITY_ACCOUNTING_FAILED');
  }
  if (rows.length === 0) addCode(codes, 'EMPTY_SOURCE_MANIFEST');

  const observationsBySourceRow = new Map<string, number>();
  const observationIds = new Set<string>();
  for (const observation of observations) {
    observationIds.add(observation.id);
    observationsBySourceRow.set(
      observation.sourceRowId,
      (observationsBySourceRow.get(observation.sourceRowId) ?? 0) + 1,
    );
  }
  const canonicalAssignmentsByObservation = new Map<string, number>();
  let usableCanonicalAssignmentCount = 0;
  for (const assignment of assignments) {
    if (
      assignment.sourceObservationId === null ||
      !observationIds.has(assignment.sourceObservationId)
    )
      continue;
    if (
      assignment.originType !== 'TELESTAFF_IMPORT' ||
      assignment.status !== 'active' ||
      assignment.staffingReviewStatus !== 'approved'
    ) {
      addCode(codes, 'UNUSABLE_CANONICAL_ASSIGNMENT');
      continue;
    }
    canonicalAssignmentsByObservation.set(
      assignment.sourceObservationId,
      (canonicalAssignmentsByObservation.get(assignment.sourceObservationId) ?? 0) + 1,
    );
    usableCanonicalAssignmentCount += 1;
  }

  let resolvedRowCount = 0;
  let reviewedExceptionCount = 0;
  let incompleteTopologyCount = 0;
  let unresolvedIncompleteTopology = 0;
  let unreviewedMappings = 0;
  let missingObservations = 0;
  let unknownEmployees = 0;
  let ambiguousMappings = 0;
  let unresolvedRows = 0;

  for (const row of rows) {
    const classification = row.classification;
    const observationCount = observationsBySourceRow.get(row.id) ?? 0;
    const hasExactlyOneObservation = observationCount === 1;
    let terminal = false;
    let reviewedException = false;
    let rowBlocked = false;
    if (observationCount > 1) {
      addCode(codes, 'DUPLICATE_SOURCE_OBSERVATION');
      rowBlocked = true;
    }

    const topologyValid =
      importRecord.sourceFormat === 'TELSTAFF_ASSIGNMENTS_HTML_V1'
        ? isStructuredTopologyValid(row.normalizedSourceTopology, row.sourceTopologyCompleteness)
        : hasNonBlankText(row.normalizedSourceTopology);
    if (!topologyValid) {
      addCode(codes, 'INVALID_NORMALIZED_SOURCE_TOPOLOGY');
      rowBlocked = true;
    }
    if (row.sourceTopologyCompleteness === 'incomplete') incompleteTopologyCount += 1;

    if (classification === 'UNKNOWN_EMPLOYEE') {
      unknownEmployees += 1;
      terminal =
        row.reviewStatus === 'rejected' &&
        row.resolutionAction === 'REJECT_SOURCE_ROW' &&
        row.staffingPositionSourceMappingId === null &&
        observationCount === 0;
      reviewedException = terminal;
      if (!terminal) {
        unreviewedMappings += 1;
        addCode(codes, 'UNKNOWN_EMPLOYEE');
        rowBlocked = true;
      }
    } else if (classification === 'AMBIGUOUS_MAPPING') {
      ambiguousMappings += 1;
      terminal =
        row.reviewStatus === 'rejected' &&
        row.resolutionAction === 'REJECT_SOURCE_ROW' &&
        row.staffingPositionSourceMappingId === null &&
        observationCount === 0;
      reviewedException = terminal;
      if (!terminal) {
        unreviewedMappings += 1;
        addCode(codes, 'AMBIGUOUS_MAPPING');
        rowBlocked = true;
      }
      if (row.sourceTopologyCompleteness === 'incomplete') {
        unresolvedIncompleteTopology += 1;
        addCode(codes, 'INCOMPLETE_TOPOLOGY_CLASSIFICATION_REQUIRED');
        rowBlocked = true;
      }
    } else if (classification === 'INCOMPLETE_TOPOLOGY') {
      terminal =
        row.sourceTopologyCompleteness === 'incomplete' &&
        row.staffingPositionSourceMappingId === null &&
        observationCount === 0 &&
        ((row.reviewStatus === 'approved' &&
          row.resolutionAction === 'RETAIN_UNMATERIALIZED_SOURCE_ROW') ||
          (row.reviewStatus === 'rejected' && row.resolutionAction === 'REJECT_SOURCE_ROW'));
      reviewedException = terminal;
      if (!terminal) {
        unresolvedIncompleteTopology += 1;
        addCode(codes, 'UNRESOLVED_INCOMPLETE_TOPOLOGY');
        rowBlocked = true;
      }
    } else if (row.sourceTopologyCompleteness === 'incomplete') {
      unresolvedIncompleteTopology += 1;
      addCode(codes, 'INCOMPLETE_TOPOLOGY_CLASSIFICATION_REQUIRED');
      rowBlocked = true;
    } else if (classification === null) {
      unreviewedMappings += 1;
      addCode(codes, 'UNCLASSIFIED_SOURCE_ROW');
      rowBlocked = true;
    } else if (classification === 'UNCHANGED') {
      terminal =
        row.reviewStatus === 'not_required' &&
        row.resolvedMemberId !== null &&
        row.staffingPositionSourceMappingId !== null &&
        hasExactlyOneObservation;
      if (!terminal) {
        if (
          row.reviewStatus !== 'not_required' ||
          row.resolvedMemberId === null ||
          row.staffingPositionSourceMappingId === null
        ) {
          unreviewedMappings += 1;
          addCode(codes, 'UNRESOLVED_SOURCE_MAPPING');
        }
        if (observationCount === 0) {
          missingObservations += 1;
          addCode(codes, 'MISSING_REQUIRED_OBSERVATION');
        }
        rowBlocked = true;
      }
    } else if (classification === 'MOVED' || classification === 'NEW_ASSIGNMENT') {
      const approvedProjection =
        row.reviewStatus === 'approved' &&
        row.resolutionAction === 'APPLY_OBSERVATION' &&
        row.resolvedMemberId !== null &&
        row.staffingPositionSourceMappingId !== null &&
        hasExactlyOneObservation;
      const reviewedRejection =
        row.reviewStatus === 'rejected' &&
        row.resolutionAction === 'REJECT_SOURCE_ROW' &&
        row.staffingPositionSourceMappingId === null &&
        observationCount === 0;
      terminal = approvedProjection || reviewedRejection;
      reviewedException = reviewedRejection;
      if (!terminal) {
        unreviewedMappings += 1;
        addCode(codes, 'UNREVIEWED_SOURCE_MAPPING');
        if (row.reviewStatus === 'approved' && observationCount === 0) {
          missingObservations += 1;
          addCode(codes, 'MISSING_REQUIRED_OBSERVATION');
        }
        rowBlocked = true;
      }
    } else if (classification === 'NEW_POSITION') {
      const terminallyDeferred =
        row.reviewStatus === 'approved' &&
        row.resolutionAction === 'DEFER_NEW_POSITION' &&
        row.staffingPositionSourceMappingId === null &&
        observationCount === 0;
      const terminallyRejected =
        row.reviewStatus === 'rejected' &&
        row.resolutionAction === 'REJECT_SOURCE_ROW' &&
        row.staffingPositionSourceMappingId === null &&
        observationCount === 0;
      terminal = terminallyDeferred || terminallyRejected;
      reviewedException = terminal;
      if (!terminal) {
        unreviewedMappings += 1;
        addCode(codes, 'UNREVIEWED_SOURCE_MAPPING');
        rowBlocked = true;
      }
    } else {
      // MISSING_OBSERVATION belongs in its dedicated table, never in a source
      // manifest row. Unknown future labels likewise fail closed.
      unreviewedMappings += 1;
      addCode(codes, 'UNSUPPORTED_SOURCE_RECONCILIATION_CLASSIFICATION');
      rowBlocked = true;
    }

    if (terminal && !rowBlocked) {
      resolvedRowCount += 1;
      if (reviewedException) reviewedExceptionCount += 1;
    } else {
      unresolvedRows += 1;
    }
  }

  for (const observationId of observationIds) {
    if ((canonicalAssignmentsByObservation.get(observationId) ?? 0) !== 1) {
      addCode(codes, 'MISSING_CANONICAL_ASSIGNMENT');
    }
  }
  const unresolvedMissingObservationFindings = missingFindings.filter(
    (finding) => finding.reviewStatus !== 'resolved',
  ).length;
  if (unresolvedMissingObservationFindings > 0) {
    addCode(codes, 'UNRESOLVED_MISSING_OBSERVATION');
  }

  const sourceManifestIntact =
    manifestCountsMatch &&
    sourceRowNumbers.size === rows.length &&
    fingerprints.size === rows.length &&
    employeeHmacs.size === rows.length;
  const blockingCodes = [...codes].sort((left, right) => left.localeCompare(right));
  return {
    status: blockingCodes.length === 0 ? 'PASS' : 'BLOCKED',
    importId: importRecord.id,
    sourceSystem: importRecord.sourceSystem,
    sourceFormat: importRecord.sourceFormat,
    parserVersion: importRecord.parserVersion,
    sourceKind: importRecord.sourceKind,
    sourceHashPresent: /^[a-f0-9]{64}$/i.test(importRecord.sourceHash),
    sourceHash: /^[a-f0-9]{64}$/i.test(importRecord.sourceHash)
      ? importRecord.sourceHash.toLowerCase()
      : null,
    sourceManifestIntact,
    inputRowCount: importRecord.inputRowCount,
    normalizedDataRowCount: importRecord.normalizedDataRowCount,
    uniqueEmployeeCount: importRecord.uniqueEmployeeCount,
    reportRowCount: importRecord.reportRowCount,
    structuralRowCount: importRecord.structuralRowCount,
    sourceRowCount: rows.length,
    resolvedRowCount,
    reviewedExceptionCount,
    incompleteTopologyCount,
    observationCount: observations.length,
    canonicalAssignmentCount: usableCanonicalAssignmentCount,
    missingObservations,
    unresolvedIncompleteTopology,
    unreviewedMappings,
    unresolvedMissingObservationFindings,
    unknownEmployees,
    ambiguousMappings,
    unresolvedRows,
    blockingCodes,
  };
}

/**
 * Evaluates the explicit annual baseline designation. An arbitrary committed
 * import cannot satisfy this gate, even if it contains one valid assignment.
 */
export async function evaluateAuthoritativeStaffingBaseline(
  db: DB,
  bidYear: number,
): Promise<AuthoritativeStaffingBaselineEvaluation> {
  const accepted = await db
    .select({
      id: bidYearStaffingBaselines.id,
      importId: bidYearStaffingBaselines.assignmentImportId,
      acceptedAt: bidYearStaffingBaselines.acceptedAt,
    })
    .from(bidYearStaffingBaselines)
    .where(
      and(
        eq(bidYearStaffingBaselines.bidYear, bidYear),
        eq(bidYearStaffingBaselines.status, 'accepted'),
      ),
    )
    .all();

  const acceptedBaseline = accepted[0];
  if (accepted.length !== 1 || acceptedBaseline === undefined) {
    const absent = defaultCompleteness();
    return {
      ...absent,
      bidYear,
      baselineAcceptanceId: null,
      baselineAcceptedAtMs: null,
      blockingCodes: [
        accepted.length === 0
          ? 'NO_ACCEPTED_TELESTAFF_BASELINE'
          : 'AMBIGUOUS_ACCEPTED_TELESTAFF_BASELINE',
      ],
    };
  }

  const completeness = await evaluateTeleStaffImportCompleteness(db, acceptedBaseline.importId);
  const blockingCodes =
    completeness.sourceKind === 'official'
      ? completeness.blockingCodes
      : [...new Set([...completeness.blockingCodes, 'NON_OFFICIAL_SOURCE_BASELINE'])].sort(
          (left, right) => left.localeCompare(right),
        );
  return {
    ...completeness,
    status: blockingCodes.length === 0 ? 'PASS' : 'BLOCKED',
    bidYear,
    baselineAcceptanceId: acceptedBaseline.id,
    baselineAcceptedAtMs: acceptedBaseline.acceptedAt.getTime(),
    blockingCodes,
  };
}
