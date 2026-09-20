import type { DepartmentRosterPosition, DepartmentRosterProjection } from '@mbfd/shared';
import {
  DepartmentOrganizationError,
  loadDepartmentOrganization,
  resolveDepartmentPositionOrganization,
} from './department-organization.js';
import { loadDepartmentPersonnel } from './department-personnel.js';
export type { DepartmentRosterPosition, DepartmentRosterProjection } from '@mbfd/shared';
interface CurrentRosterDbRow {
  id: string;
  stable_slot_key: string;
  division: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
  position_name: string | null;
  applicable_rank: string | null;
  review_status: 'draft' | 'approved' | 'retired';
  assignment_id: string | null;
  assignment_member_id: number | null;
  assignment_origin_type: string | null;
  assignment_status: string | null;
  assignment_effective_from: string | null;
  assignment_effective_to: string | null;
  member_id: number | null;
  member_employee_id: string | null;
  member_first_name: string | null;
  member_last_name: string | null;
  member_rank: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function canonicalRosterShift(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  const match = /^([A-Z])(?: SHIFT(?:\s+.*)?)?$/.exec(normalized);
  if (match?.[1] !== undefined) return match[1];
  if (normalized === 'D / DAYS' || normalized === 'DAYS') return 'D';
  return value;
}

function readFilter(value: string | undefined, name: string): { value?: string; error?: string } {
  if (value === undefined) return {};
  const trimmed = value.trim();
  // Resolved station, apparatus and group names use the organization catalog's
  // 160-character display-name bound. Other legacy filters retain their bound.
  const maxLength = ['station', 'unit', 'division'].includes(name) ? 160 : 128;
  if (trimmed.length === 0 || trimmed.length > maxLength) return { error: `invalid_${name}` };
  return { value: trimmed };
}

/**
 * members uses Drizzle epoch seconds, while existing raw personnel/import
 * writers persist epoch milliseconds in the same column. For modern MBFD
 * source timestamps (2000-2100), 100 billion separates these representations
 * unambiguously. Apply this per row before MAX so newer seconds are not hidden
 * by an older millisecond value. Other source tables already use milliseconds.
 */
function mixedEpochMillisecondsSql(column: 'updated_at'): string {
  return `CASE WHEN ${column} < 100000000000 THEN ${column} * 1000 ELSE ${column} END`;
}

export type DepartmentRosterResult =
  | { ok: true; projection: DepartmentRosterProjection }
  | { ok: false; error: string };

/**
 * A single, read-only roster projection drives both the operator screen and
 * its CSV download. Keeping the query here prevents the export from drifting
 * into a different effective-date or policy interpretation than the screen.
 */
export async function loadDepartmentRosterProjection(
  db: D1Database,
  requestedAsOf: string,
  filterInputs: ReadonlyArray<{ name: string; value: string | undefined }>,
): Promise<DepartmentRosterResult> {
  const columnByFilter: Record<string, string> = {
    shift: 'sp.shift',
    station: 'sp.station',
    division: 'sp.division',
    unit: 'sp.unit',
    rank: 'sp.applicable_rank',
  };
  if (!isCalendarDate(requestedAsOf)) return { ok: false, error: 'invalid_as_of' };
  const unknownFilter = filterInputs.find(({ name }) => !Object.hasOwn(columnByFilter, name));
  if (unknownFilter) return { ok: false, error: 'invalid_filter' };
  const parsedFilters = filterInputs.map(({ name, value }) => ({
    name,
    ...readFilter(value, name),
  }));
  const invalid = parsedFilters.find((result) => result.error !== undefined)?.error;
  if (invalid) return { ok: false, error: invalid };

  const where = [
    "sp.review_status IN ('approved', 'retired')",
    '(sp.active_from IS NULL OR sp.active_from <= ?)',
    '(sp.active_to IS NULL OR sp.active_to >= ?)',
  ];
  const bindings: Array<string | null> = [
    requestedAsOf,
    requestedAsOf,
    requestedAsOf,
    requestedAsOf,
    requestedAsOf,
  ];

  const rosterResult = await db
    .prepare(
      `SELECT
         sp.id,
         sp.stable_slot_key,
         sp.division,
         sp.shift,
         sp.station,
         sp.unit,
         sp.position_name,
         sp.applicable_rank,
         sp.review_status,
         assignment_record.id AS assignment_id,
         assignment_record.member_id AS assignment_member_id,
         assignment_record.origin_type AS assignment_origin_type,
         assignment_record.status AS assignment_status,
         assignment_record.effective_from AS assignment_effective_from,
         assignment_record.effective_to AS assignment_effective_to,
         assigned_member.id AS member_id,
         assigned_member.employee_id AS member_employee_id,
         assigned_member.first_name AS member_first_name,
         assigned_member.last_name AS member_last_name,
         COALESCE(
           (
             SELECT lifecycle_event.rank_after
             FROM personnel_lifecycle_events lifecycle_event
             WHERE lifecycle_event.member_id = assigned_member.id
               AND lifecycle_event.effective_on <= ?
               AND lifecycle_event.rank_after IS NOT NULL
             ORDER BY lifecycle_event.effective_on DESC, lifecycle_event.created_at DESC,
                      lifecycle_event.id DESC
             LIMIT 1
           ),
           assigned_member.rank
         ) AS member_rank

       FROM staffing_positions sp
       LEFT JOIN member_assignments assignment_record
         ON assignment_record.id = (
           SELECT candidate.id
           FROM member_assignments candidate
           WHERE candidate.staffing_position_id = sp.id
             AND (
               candidate.status IN ('planned', 'active')
               OR (
                 candidate.status IN ('ended', 'superseded')
                 AND candidate.effective_to IS NOT NULL
               )
             )
             AND candidate.effective_from <= ?
             AND (candidate.effective_to IS NULL OR candidate.effective_to >= ?)
           ORDER BY candidate.effective_from DESC, candidate.created_at DESC, candidate.id DESC
           LIMIT 1
         )
       LEFT JOIN members assigned_member ON assigned_member.id = assignment_record.member_id
       WHERE ${where.join(' AND ')}
       ORDER BY
         COALESCE(sp.shift, ''),
         COALESCE(sp.station, ''),
         COALESCE(sp.unit, ''),
         sp.stable_slot_key`,
    )
    .bind(...bindings)
    .all();
  const rosterRows = rosterResult.results as unknown as CurrentRosterDbRow[];

  const personnel = await loadDepartmentPersonnel(db, requestedAsOf);
  const personnelById = new Map(personnel.map((member) => [member.id, member]));
  const unassignedRows = personnel.filter(
    (member) =>
      !member.hasAssignment && !['retired', 'separated'].includes(member.employmentStatus),
  );

  // An overlay does not replace the member's canonical underlying assignment.
  // A planned end is context, not evidence that the overlay actually ended.
  const overlays = await db
    .prepare(`SELECT id, underlying_assignment_id AS assignmentId, kind,
    effective_on AS effectiveOn, planned_end_on AS plannedEndOn, actual_end_on AS actualEndOn
    FROM temporary_operational_overlays WHERE status IN ('active', 'ended')
      AND effective_on <= ? AND (actual_end_on IS NULL OR actual_end_on > ?)
    ORDER BY effective_on, id`)
    .bind(requestedAsOf, requestedAsOf)
    .all<{
      id: string;
      assignmentId: string;
      kind: 'SPECIAL_ASSIGNMENT' | 'LIGHT_DUTY';
      effectiveOn: string;
      plannedEndOn: string | null;
      actualEndOn: string | null;
    }>();

  const allPositions: DepartmentRosterPosition[] = rosterRows.map((row) => ({
    id: row.id,
    stableSlotKey: row.stable_slot_key,
    division: row.division,
    shift: canonicalRosterShift(row.shift),
    station: row.station,
    unit: row.unit,
    positionName: row.position_name,
    applicableRank: row.applicable_rank,
    reviewStatus: row.review_status,
    occupancy: row.assignment_id === null ? ('vacant' as const) : ('occupied' as const),
    temporaryContext: overlays.results
      .filter((overlay) => overlay.assignmentId === row.assignment_id)
      .map(({ assignmentId: _assignment, ...overlay }) => overlay),
    assignment:
      row.assignment_id === null || row.assignment_member_id === null
        ? null
        : {
            id: row.assignment_id,
            memberId: row.assignment_member_id,
            originType: row.assignment_origin_type,
            status: row.assignment_status,
            effectiveFrom: row.assignment_effective_from,
            effectiveTo: row.assignment_effective_to,
          },
    member:
      row.member_id === null
        ? null
        : {
            id: row.member_id,
            employeeId: row.member_employee_id,
            firstName: row.member_first_name,
            lastName: row.member_last_name,
            rank: personnelById.get(row.member_id)?.rank ?? row.member_rank,
          },
  }));

  const organization = await loadDepartmentOrganization(db, requestedAsOf);
  let organizedPositions: DepartmentRosterPosition[];
  try {
    organizedPositions = allPositions.map((position) => {
      const { station, unit, division, ...identity } = resolveDepartmentPositionOrganization(
        position,
        organization,
      );
      return { ...position, station, unit, division, organization: identity };
    });
  } catch (error) {
    if (error instanceof DepartmentOrganizationError) return { ok: false, error: error.message };
    throw error;
  }
  const positions = organizedPositions.filter((position) =>
    parsedFilters.every(({ name, value }) => {
      if (value === undefined) return true;
      if (name === 'shift') return position.shift === canonicalRosterShift(value);
      const field =
        name === 'rank'
          ? position.applicableRank
          : position[name as 'station' | 'division' | 'unit'];
      return field === value;
    }),
  );
  // D1 limits compound SELECT terms. VALUES keeps all source maxima in one
  // read snapshot without a UNION chain; MAX still ignores empty sources.
  const sourceUpdate = await db
    .prepare(`WITH source_updates(changed_at) AS (VALUES
    ((SELECT MAX(updated_at) FROM staffing_positions)),
    ((SELECT MAX(updated_at) FROM member_assignments)),
    ((SELECT MAX(${mixedEpochMillisecondsSql('updated_at')}) FROM members)),
    ((SELECT MAX(created_at) FROM personnel_lifecycle_events)),
    ((SELECT MAX(created_at) FROM organization_unit_versions)),
    ((SELECT MAX(created_at) FROM organization_staffing_links)),
    ((SELECT MAX(created_at) FROM temporary_operational_overlays))
  ) SELECT MAX(changed_at) AS updatedAt FROM source_updates`)
    .first<{ updatedAt: number | null }>();
  const updatedAt = sourceUpdate?.updatedAt ?? null;

  const occupiedPositions = positions.filter(
    (position) => position.occupancy === 'occupied',
  ).length;
  return {
    ok: true,
    projection: {
      asOf: requestedAsOf,
      updatedAt,
      organizationUnits: organization.units,
      positions,
      summary: {
        totalPositions: positions.length,
        occupiedPositions,
        vacantPositions: positions.length - occupiedPositions,
      },
      unassignedMembers: unassignedRows.map((member) => ({
        id: member.id,
        employeeId: member.employeeId,
        firstName: member.firstName,
        lastName: member.lastName,
        rank: member.rank,
      })),
    },
  };
}
