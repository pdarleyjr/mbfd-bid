import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';

import { createCsvStream } from '../../lib/csv-stream.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

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
  administrative_assignment: number;
}

interface UnassignedMemberDbRow {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  rank: string;
  bid_category: string;
}

interface BidYearPolicyDbRow {
  rule_book_version: string | null;
}

interface AssignmentHistoryDbRow {
  id: string;
  member_id: number;
  staffing_position_id: string;
  origin_type: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  created_at: number;
  updated_at: number;
}

interface CurrentRosterPosition {
  id: string;
  stableSlotKey: string;
  division: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
  positionName: string | null;
  applicableRank: string | null;
  reviewStatus: 'draft' | 'approved' | 'retired';
  occupancy: 'occupied' | 'vacant';
  administrativeAssignment: boolean;
  assignment: {
    id: string;
    memberId: number;
    originType: string | null;
    status: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  } | null;
  member: {
    id: number;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    rank: string | null;
  } | null;
}

interface CurrentRosterProjection {
  asOf: string;
  administrativeAssignmentPolicy: {
    status: 'configured' | 'unconfigured';
    bidYear: number;
    ruleBookVersion: string | null;
  };
  positions: CurrentRosterPosition[];
  summary: {
    totalPositions: number;
    occupiedPositions: number;
    vacantPositions: number;
    administrativelyAssignedNonBiddablePositions: number;
  };
  unassignedMembers: Array<{
    id: number;
    employeeId: string;
    firstName: string;
    lastName: string;
    rank: string;
    bidCategory: string;
  }>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function canonicalRosterShift(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  const match = /^([ABCD])(?: SHIFT(?:\s+.*)?)?$/.exec(normalized);
  if (match?.[1] !== undefined) return match[1];
  if (normalized === 'D / DAYS' || normalized === 'DAYS') return 'D';
  return value;
}

function readFilter(value: string | undefined, name: string): { value?: string; error?: string } {
  if (value === undefined) return {};
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return { error: `invalid_${name}` };
  return { value: trimmed };
}

function mapAssignment(row: AssignmentHistoryDbRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    staffingPositionId: row.staffing_position_id,
    originType: row.origin_type,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type RosterProjectionResult =
  | { ok: true; projection: CurrentRosterProjection }
  | { ok: false; error: string };

/**
 * A single, read-only roster projection drives both the operator screen and
 * its CSV download. Keeping the query here prevents the export from drifting
 * into a different effective-date or policy interpretation than the screen.
 */
async function loadCurrentRosterProjection(
  db: D1Database,
  requestedAsOf: string,
  filterInputs: ReadonlyArray<{ name: string; value: string | undefined }>,
): Promise<RosterProjectionResult> {
  const requestedBidYear = Number.parseInt(requestedAsOf.slice(0, 4), 10);
  const configuredPolicyResult = await db
    .prepare('SELECT rule_book_version FROM bid_years WHERE year = ? LIMIT 1')
    .bind(requestedBidYear)
    .all();
  const configuredPolicy = configuredPolicyResult.results[0] as BidYearPolicyDbRow | undefined;
  const designatedRuleBookVersion = configuredPolicy?.rule_book_version ?? null;
  const administrativeAssignmentPolicy = {
    status:
      designatedRuleBookVersion === null ? ('unconfigured' as const) : ('configured' as const),
    bidYear: requestedBidYear,
    ruleBookVersion: designatedRuleBookVersion,
  };

  const columnByFilter: Record<string, string> = {
    shift: 'sp.shift',
    station: 'sp.station',
    division: 'sp.division',
    unit: 'sp.unit',
    rank: 'sp.applicable_rank',
  };
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
    designatedRuleBookVersion,
    requestedAsOf,
    requestedAsOf,
    requestedAsOf,
    requestedAsOf,
  ];
  for (const { name, value } of parsedFilters) {
    if (!value) continue;
    if (name === 'shift' && /^[ABCD]$/.test(value.toUpperCase())) {
      where.push(
        `CASE
           WHEN UPPER(TRIM(sp.shift)) = 'A' OR UPPER(TRIM(sp.shift)) LIKE 'A SHIFT%' THEN 'A'
           WHEN UPPER(TRIM(sp.shift)) = 'B' OR UPPER(TRIM(sp.shift)) LIKE 'B SHIFT%' THEN 'B'
           WHEN UPPER(TRIM(sp.shift)) = 'C' OR UPPER(TRIM(sp.shift)) LIKE 'C SHIFT%' THEN 'C'
           WHEN UPPER(TRIM(sp.shift)) = 'D' OR UPPER(TRIM(sp.shift)) LIKE 'D SHIFT%'
             OR UPPER(TRIM(sp.shift)) IN ('D / DAYS', 'DAYS') THEN 'D'
           ELSE UPPER(TRIM(sp.shift))
         END = ?`,
      );
      bindings.push(value.toUpperCase());
      continue;
    }
    where.push(`${columnByFilter[name]} = ?`);
    bindings.push(value);
  }

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
         ) AS member_rank,
          CASE WHEN EXISTS (
            SELECT 1
            FROM position_staffing_bindings binding
            JOIN rule_book_position_participation participation
              ON participation.position_id = binding.position_id
              AND participation.template_version = binding.template_version
            WHERE binding.staffing_position_id = sp.id
              AND binding.review_status = 'approved'
              -- This projection is policy metadata, not a search for any active
              -- rule book. The selected year must explicitly designate the book.
              AND participation.rule_book_version = ?
              AND participation.bid_participation = 'ADMIN_ASSIGNED_NON_BIDDABLE'
          ) THEN 1 ELSE 0 END AS administrative_assignment
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

  const unassignedResult = await db
    .prepare(
      `SELECT id, employee_id, first_name, last_name,
              COALESCE(
                (
                  SELECT lifecycle_event.rank_after
                  FROM personnel_lifecycle_events lifecycle_event
                  WHERE lifecycle_event.member_id = member_record.id
                    AND lifecycle_event.effective_on <= ?
                    AND lifecycle_event.rank_after IS NOT NULL
                  ORDER BY lifecycle_event.effective_on DESC, lifecycle_event.created_at DESC,
                           lifecycle_event.id DESC
                  LIMIT 1
                ),
                member_record.rank
              ) AS rank,
              bid_category
       FROM members member_record
       WHERE COALESCE(
         (
           SELECT lifecycle_event.employment_status_after
           FROM personnel_lifecycle_events lifecycle_event
           WHERE lifecycle_event.member_id = member_record.id
             AND lifecycle_event.effective_on <= ?
             AND lifecycle_event.employment_status_after IS NOT NULL
           ORDER BY lifecycle_event.effective_on DESC, lifecycle_event.created_at DESC,
                    lifecycle_event.id DESC
           LIMIT 1
         ),
         member_record.employment_status
       ) NOT IN ('retired', 'separated')
         AND NOT EXISTS (
         SELECT 1
         FROM member_assignments assignment_record
         WHERE assignment_record.member_id = member_record.id
           AND (
             assignment_record.status IN ('planned', 'active')
             OR (
               assignment_record.status IN ('ended', 'superseded')
               AND assignment_record.effective_to IS NOT NULL
             )
           )
           AND assignment_record.effective_from <= ?
           AND (assignment_record.effective_to IS NULL OR assignment_record.effective_to >= ?)
       )
       ORDER BY last_name, first_name, id`,
    )
    .bind(requestedAsOf, requestedAsOf, requestedAsOf, requestedAsOf)
    .all();
  const unassignedRows = unassignedResult.results as unknown as UnassignedMemberDbRow[];

  const positions: CurrentRosterPosition[] = rosterRows.map((row) => ({
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
    administrativeAssignment: row.administrative_assignment === 1,
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
            rank: row.member_rank,
          },
  }));

  const occupiedPositions = positions.filter(
    (position) => position.occupancy === 'occupied',
  ).length;
  return {
    ok: true,
    projection: {
      asOf: requestedAsOf,
      administrativeAssignmentPolicy,
      positions,
      summary: {
        totalPositions: positions.length,
        occupiedPositions,
        vacantPositions: positions.length - occupiedPositions,
        administrativelyAssignedNonBiddablePositions: positions.filter(
          (position) => position.administrativeAssignment,
        ).length,
      },
      unassignedMembers: unassignedRows.map((member) => ({
        id: member.id,
        employeeId: member.employee_id,
        firstName: member.first_name,
        lastName: member.last_name,
        rank: member.rank,
        bidCategory: member.bid_category,
      })),
    },
  };
}

function requestProjectionInput(c: { req: { query(name: string): string | undefined } }):
  | {
      requestedAsOf: string;
      filterInputs: ReadonlyArray<{ name: string; value: string | undefined }>;
    }
  | { error: string } {
  const requestedAsOf = c.req.query('as_of') ?? currentUtcDate();
  if (!isCalendarDate(requestedAsOf)) return { error: 'invalid_as_of' };
  return {
    requestedAsOf,
    filterInputs: [
      { name: 'shift', value: c.req.query('shift') },
      { name: 'station', value: c.req.query('station') },
      { name: 'division', value: c.req.query('division') },
      { name: 'unit', value: c.req.query('unit') },
      { name: 'rank', value: c.req.query('rank') },
    ],
  };
}

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

/**
 * Read-only canonical roster projection. It intentionally reports staffing
 * capacity and current occupancy separately; a vacant slot is never inferred
 * to be a Bid opportunity.
 */
router.get('/', async (c) => {
  const input = requestProjectionInput(c);
  if ('error' in input) return c.json({ error: input.error }, 400);
  const result = await loadCurrentRosterProjection(
    c.env.DB,
    input.requestedAsOf,
    input.filterInputs,
  );
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result.projection);
});

/**
 * Download the exact effective-dated staffing projection currently visible to
 * an administrator. This is intentionally direct CSV (no R2/PDF dependency)
 * and does not alter the canonical roster.
 */
router.get('/export.csv', async (c) => {
  const input = requestProjectionInput(c);
  if ('error' in input) return c.json({ error: input.error }, 400);
  const result = await loadCurrentRosterProjection(
    c.env.DB,
    input.requestedAsOf,
    input.filterInputs,
  );
  if (!result.ok) return c.json({ error: result.error }, 400);

  const { projection } = result;
  async function* rows() {
    for (const position of projection.positions) {
      yield position;
    }
  }

  return new Response(
    createCsvStream(rows(), [
      { header: 'as_of', value: () => projection.asOf },
      { header: 'stable_slot_key', value: (row) => row.stableSlotKey },
      { header: 'shift', value: (row) => row.shift },
      { header: 'station', value: (row) => row.station },
      { header: 'division', value: (row) => row.division },
      { header: 'unit', value: (row) => row.unit },
      { header: 'position_name', value: (row) => row.positionName },
      { header: 'applicable_rank', value: (row) => row.applicableRank },
      { header: 'review_status', value: (row) => row.reviewStatus },
      { header: 'occupancy', value: (row) => row.occupancy },
      {
        header: 'administratively_assigned_non_biddable',
        value: (row) => row.administrativeAssignment,
      },
      { header: 'assignment_id', value: (row) => row.assignment?.id },
      { header: 'assignment_status', value: (row) => row.assignment?.status },
      { header: 'assignment_origin_type', value: (row) => row.assignment?.originType },
      { header: 'assignment_effective_from', value: (row) => row.assignment?.effectiveFrom },
      { header: 'assignment_effective_to', value: (row) => row.assignment?.effectiveTo },
      { header: 'member_id', value: (row) => row.member?.id },
      { header: 'employee_id', value: (row) => row.member?.employeeId },
      { header: 'member_first_name', value: (row) => row.member?.firstName },
      { header: 'member_last_name', value: (row) => row.member?.lastName },
      { header: 'member_rank', value: (row) => row.member?.rank },
    ]),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mbfd-current-roster-${projection.asOf}.csv"`,
        'Cache-Control': 'no-store',
      },
    },
  );
});

/**
 * An admin can inspect an assignment's member and slot history without seeing
 * raw TeleStaff source material. This is a read-only explanation surface.
 */
router.get('/assignments/:id/history', async (c) => {
  const assignmentId = c.req.param('id');
  if (assignmentId.trim().length === 0 || assignmentId.length > 128) {
    return c.json({ error: 'invalid_assignment_id' }, 400);
  }

  const assignmentResult = await c.env.DB.prepare(
    `SELECT id, member_id, staffing_position_id, origin_type, status,
            effective_from, effective_to, created_at, updated_at
     FROM member_assignments
     WHERE id = ?`,
  )
    .bind(assignmentId)
    .all();
  const assignment = (assignmentResult.results as unknown as AssignmentHistoryDbRow[])[0];
  if (!assignment) return c.json({ error: 'not_found' }, 404);

  const [memberHistoryResult, positionHistoryResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, member_id, staffing_position_id, origin_type, status,
                effective_from, effective_to, created_at, updated_at
         FROM member_assignments
         WHERE member_id = ?
         ORDER BY effective_from DESC, created_at DESC, id DESC`,
    )
      .bind(assignment.member_id)
      .all(),
    c.env.DB.prepare(
      `SELECT id, member_id, staffing_position_id, origin_type, status,
                effective_from, effective_to, created_at, updated_at
         FROM member_assignments
         WHERE staffing_position_id = ?
         ORDER BY effective_from DESC, created_at DESC, id DESC`,
    )
      .bind(assignment.staffing_position_id)
      .all(),
  ]);

  return c.json({
    assignment: mapAssignment(assignment),
    memberHistory: (memberHistoryResult.results as unknown as AssignmentHistoryDbRow[]).map(
      mapAssignment,
    ),
    positionHistory: (positionHistoryResult.results as unknown as AssignmentHistoryDbRow[]).map(
      mapAssignment,
    ),
  });
});

export default router;
