import { getDb } from '../../../src/db/index.js';
import { acceptAuthoritativeStaffingBaseline } from '../../../src/lib/authoritative-staffing-baseline-acceptance.js';
import type { TestD1 } from './test-d1.js';

export const SYNTHETIC_BASELINE_NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

export type SyntheticSourceClassification =
  | 'UNCHANGED'
  | 'INCOMPLETE_TOPOLOGY'
  | 'UNKNOWN_EMPLOYEE'
  | 'AMBIGUOUS_MAPPING';

export interface SyntheticBaselineRow {
  sourceRowNumber: number;
  normalizedTopology: string;
  sourceARDay?: string | null;
  topologyCompleteness?: 'complete' | 'incomplete';
  classification?: SyntheticSourceClassification;
  employeeIdentity?: string;
  materializeObservation?: boolean;
  reviewStatus?: 'not_required' | 'pending' | 'approved' | 'rejected';
}

export interface SeedAuthoritativeBaselineOptions {
  bidYear: number;
  importId: string;
  rows: readonly SyntheticBaselineRow[];
  sourceFormat?: 'TELSTAFF_ASSIGNMENTS_LEGACY_V1' | 'TELSTAFF_ASSIGNMENTS_HTML_V1';
  sourceKind?: 'official' | 'synthetic_test';
  parserVersion?: string;
  inputRowCount?: number;
  normalizedDataRowCount?: number;
  uniqueEmployeeCount?: number;
  persistedRows?: readonly SyntheticBaselineRow[];
  commit?: boolean;
  accept?: boolean;
}

function hexFor(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function dispositionFor(classification: SyntheticSourceClassification): string {
  if (classification === 'UNCHANGED') return 'unchanged';
  if (classification === 'UNKNOWN_EMPLOYEE') return 'unknown_employee';
  return 'ambiguous_mapping';
}

function defaultReviewStatus(
  classification: SyntheticSourceClassification,
): 'not_required' | 'pending' | 'approved' | 'rejected' {
  if (classification === 'UNCHANGED') return 'not_required';
  if (classification === 'INCOMPLETE_TOPOLOGY') return 'approved';
  return 'rejected';
}

function resolutionActionFor(
  classification: SyntheticSourceClassification,
  reviewStatus: 'not_required' | 'pending' | 'approved' | 'rejected',
): string | null {
  if (reviewStatus === 'pending' || reviewStatus === 'not_required') return null;
  if (classification === 'INCOMPLETE_TOPOLOGY' && reviewStatus === 'approved') {
    return 'RETAIN_UNMATERIALIZED_SOURCE_ROW';
  }
  return 'REJECT_SOURCE_ROW';
}

function canonicalSyntheticTopology(
  supplied: string,
  sourceRowNumber: number,
  completeness: 'complete' | 'incomplete',
): string {
  let parsed: Record<string, unknown> = {};
  try {
    const candidate: unknown = JSON.parse(supplied);
    if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    // Test shorthand is intentionally normalized into the same versioned
    // source topology contract the HTML adapter persists.
  }
  const textOrFallback = (key: string, fallback: string): string | null => {
    const value = parsed[key];
    return value === null
      ? null
      : typeof value === 'string' && value.trim() !== ''
        ? value
        : fallback;
  };
  const topology = {
    v: 1,
    shift: textOrFallback('shift', 'A Shift'),
    division: textOrFallback('division', 'Suppression/Rescue'),
    station: textOrFallback('station', `Synthetic-${sourceRowNumber}`),
    unit: textOrFallback('unit', 'Synthetic Unit'),
    position: textOrFallback('position', 'Synthetic Position'),
  };
  if (completeness === 'incomplete' && !Object.values(topology).some((value) => value === null)) {
    topology.unit = null;
  }
  return JSON.stringify(topology);
}

/**
 * Creates ephemeral sanitized test data. Its default `official` source kind
 * exists only to exercise the official-path acceptance database invariant; it
 * does not represent a real source designation or a fixture staged by the
 * HTML adapter. Callers can use `synthetic_test` to prove isolation guards.
 * The canonical assignment date below is intentional test setup, never derived
 * from a TeleStaff source date or parser timestamp.
 */
export async function seedAuthoritativeBaseline(
  h: TestD1,
  options: SeedAuthoritativeBaselineOptions,
): Promise<void> {
  const sourceFormat = options.sourceFormat ?? 'TELSTAFF_ASSIGNMENTS_HTML_V1';
  const sourceKind = options.sourceKind ?? 'official';
  const parserVersion = options.parserVersion ?? 'telestaff-assignments-html@1';
  const rows = options.persistedRows ?? options.rows;
  const inputRowCount = options.inputRowCount ?? options.rows.length;
  const normalizedDataRowCount = options.normalizedDataRowCount ?? inputRowCount;
  const uniqueEmployeeCount = options.uniqueEmployeeCount ?? inputRowCount;
  const shouldCommit = options.commit ?? true;
  const shouldAccept = options.accept ?? shouldCommit;
  const actorId = 9_001;
  const sourceHash = hexFor(9_999);

  h.sqlite.transaction(() => {
    h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO bid_years
           (year, status, position_template_version, rule_book_version, config_json, configuration_revision)
         VALUES (?, 'configuring', 'synthetic-template', 'synthetic-rule-book', ?, 0)`,
      )
      .run(options.bidYear, '{"v":1,"expectedDurationDays":2,"turnTimerSeconds":180}');
    h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO members
           (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
            is_probationary, created_at, updated_at)
         VALUES (?, 'synthetic-baseline-actor', 'Synthetic', 'Actor', 'CHIEF', 'Chief', 1, 0, ?, ?)`,
      )
      .run(actorId, SYNTHETIC_BASELINE_NOW, SYNTHETIC_BASELINE_NOW);

    h.sqlite
      .prepare(
        `INSERT INTO assignment_imports
           (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
            input_row_count, normalized_data_row_count, unique_employee_count, report_row_count, structural_row_count,
            source_snapshot_as_of, status, created_at)
         VALUES (?, 'telestaff', 'synthetic-source-v1', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'staged', ?)`,
      )
      .run(
        options.importId,
        sourceHash,
        sourceFormat,
        parserVersion,
        sourceKind,
        inputRowCount,
        normalizedDataRowCount,
        uniqueEmployeeCount,
        normalizedDataRowCount,
        SYNTHETIC_BASELINE_NOW,
      );

    const insertMember = h.sqlite.prepare(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (?, ?, 'Synthetic', 'Member', 'FF', 'FF', ?, 0, ?, ?)`,
    );
    const insertSlot = h.sqlite.prepare(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES (?, ?, '2026-01-01', 'approved', ?, ?)`,
    );
    const insertMapping = h.sqlite.prepare(
      `INSERT INTO staffing_position_source_mappings
         (id, staffing_position_id, source_system, source_locator, source_signature,
          source_version, source_hash, effective_from, created_at)
       VALUES (?, ?, 'telestaff', ?, ?, 'synthetic-source-v1', ?, '2026-01-01', ?)`,
    );
    const insertRow = h.sqlite.prepare(
      `INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          resolved_member_id, staffing_position_source_mapping_id, source_a_r_day,
          normalized_source_topology, source_topology_completeness, disposition,
          reconciliation_classification, review_status, resolution_action,
          reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const row of rows) {
      const classification = row.classification ?? 'UNCHANGED';
      const topologyCompleteness = row.topologyCompleteness ?? 'complete';
      const normalizedTopology = canonicalSyntheticTopology(
        row.normalizedTopology,
        row.sourceRowNumber,
        topologyCompleteness,
      );
      const reviewStatus = row.reviewStatus ?? defaultReviewStatus(classification);
      const needsMapping = topologyCompleteness === 'complete' && classification === 'UNCHANGED';
      const memberId = 10_000 + row.sourceRowNumber;
      const slotId = `${options.importId}-slot-${row.sourceRowNumber}`;
      const mappingId = `${options.importId}-mapping-${row.sourceRowNumber}`;
      const sourceRowId = `${options.importId}-row-${row.sourceRowNumber}`;
      const employeeIdentity = row.employeeIdentity ?? `synthetic-employee-${row.sourceRowNumber}`;

      if (classification !== 'UNKNOWN_EMPLOYEE') {
        insertMember.run(
          memberId,
          employeeIdentity,
          row.sourceRowNumber,
          SYNTHETIC_BASELINE_NOW,
          SYNTHETIC_BASELINE_NOW,
        );
      }
      if (needsMapping) {
        insertSlot.run(
          slotId,
          `SYNTHETIC/${options.importId}/${row.sourceRowNumber}`,
          SYNTHETIC_BASELINE_NOW,
          SYNTHETIC_BASELINE_NOW,
        );
        insertMapping.run(
          mappingId,
          slotId,
          normalizedTopology,
          hexFor(row.sourceRowNumber + 20_000),
          sourceHash,
          SYNTHETIC_BASELINE_NOW,
        );
      }

      const isFinalReview = reviewStatus === 'approved' || reviewStatus === 'rejected';
      insertRow.run(
        sourceRowId,
        options.importId,
        row.sourceRowNumber,
        hexFor(row.sourceRowNumber + 30_000),
        hexFor(row.sourceRowNumber + 40_000),
        classification === 'UNKNOWN_EMPLOYEE' ? null : memberId,
        needsMapping ? mappingId : null,
        row.sourceARDay ?? null,
        normalizedTopology,
        topologyCompleteness,
        dispositionFor(classification),
        classification,
        reviewStatus,
        resolutionActionFor(classification, reviewStatus),
        isFinalReview ? SYNTHETIC_BASELINE_NOW : null,
        isFinalReview ? actorId : null,
        isFinalReview ? 'Synthetic reviewed source evidence.' : null,
        SYNTHETIC_BASELINE_NOW,
      );
    }

    if (!shouldCommit) return;
    h.sqlite
      .prepare("UPDATE assignment_imports SET status = 'reviewed' WHERE id = ?")
      .run(options.importId);
    h.sqlite
      .prepare(
        "UPDATE assignment_imports SET status = 'approved', approved_at = ?, approved_by_member_id = ? WHERE id = ?",
      )
      .run(SYNTHETIC_BASELINE_NOW, actorId, options.importId);
    h.sqlite
      .prepare("UPDATE assignment_imports SET status = 'committed', committed_at = ? WHERE id = ?")
      .run(SYNTHETIC_BASELINE_NOW, options.importId);

    const insertObservation = h.sqlite.prepare(
      `INSERT INTO assignment_observations
         (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id,
          staffing_position_source_mapping_id, source_a_r_day, normalized_source_topology,
          observed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAssignment = h.sqlite.prepare(
      `INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id,
          status, effective_from, created_at, updated_at)
       VALUES (?, ?, ?, 'TELESTAFF_IMPORT', ?, ?, 'active', '2026-01-01', ?, ?)`,
    );
    for (const row of rows) {
      const classification = row.classification ?? 'UNCHANGED';
      const topologyCompleteness = row.topologyCompleteness ?? 'complete';
      const normalizedTopology = canonicalSyntheticTopology(
        row.normalizedTopology,
        row.sourceRowNumber,
        topologyCompleteness,
      );
      const materialize = row.materializeObservation ?? classification === 'UNCHANGED';
      if (!materialize || topologyCompleteness === 'incomplete' || classification !== 'UNCHANGED')
        continue;
      const memberId = 10_000 + row.sourceRowNumber;
      const slotId = `${options.importId}-slot-${row.sourceRowNumber}`;
      const mappingId = `${options.importId}-mapping-${row.sourceRowNumber}`;
      const sourceRowId = `${options.importId}-row-${row.sourceRowNumber}`;
      const observationId = `${options.importId}-observation-${row.sourceRowNumber}`;
      insertObservation.run(
        observationId,
        options.importId,
        sourceRowId,
        memberId,
        slotId,
        mappingId,
        row.sourceARDay ?? null,
        normalizedTopology,
        SYNTHETIC_BASELINE_NOW,
        SYNTHETIC_BASELINE_NOW,
      );
      insertAssignment.run(
        `${options.importId}-assignment-${row.sourceRowNumber}`,
        memberId,
        slotId,
        options.importId,
        observationId,
        SYNTHETIC_BASELINE_NOW,
        SYNTHETIC_BASELINE_NOW,
      );
    }
  })();

  if (!shouldAccept) return;
  const accepted = await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), {
    acceptanceId: `${options.importId}-acceptance`,
    bidYear: options.bidYear,
    importId: options.importId,
    actorMemberId: actorId,
    reason: 'Synthetic accepted source baseline for local test only.',
    acceptedAtMs: SYNTHETIC_BASELINE_NOW,
  });
  if (!accepted.ok) {
    throw new Error(`Synthetic baseline acceptance failed: ${accepted.code}`);
  }
}
