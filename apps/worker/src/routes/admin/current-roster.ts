import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
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

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

/**
 * Read-only canonical roster projection. It intentionally reports staffing
 * capacity and current occupancy separately; a vacant slot is never inferred
 * to be a Bid opportunity.
 */
router.get('/', async (c) => {
  const requestedAsOf = c.req.query('as_of') ?? currentUtcDate();
  if (!isCalendarDate(requestedAsOf)) {
    return c.json({ error: 'invalid_as_of' }, 400);
  }

  const columnByFilter: Record<string, string> = {
    shift: 'sp.shift',
    station: 'sp.station',
    unit: 'sp.unit',
    rank: 'sp.applicable_rank',
  };
  const filterInputs: ReadonlyArray<{ name: string; value: string | undefined }> = [
    { name: 'shift', value: c.req.query('shift') },
    { name: 'station', value: c.req.query('station') },
    { name: 'unit', value: c.req.query('unit') },
    { name: 'rank', value: c.req.query('rank') },
  ];
  const parsedFilters = filterInputs.map(({ name, value }) => ({
    name,
    ...readFilter(value, name),
  }));
  const invalid = parsedFilters.find((result) => result.error !== undefined)?.error;
  if (invalid) return c.json({ error: invalid }, 400);

  const where = [
    "sp.review_status IN ('approved', 'retired')",
    '(sp.active_from IS NULL OR sp.active_from <= ?)',
    '(sp.active_to IS NULL OR sp.active_to >= ?)',
  ];
  const bindings: string[] = [requestedAsOf, requestedAsOf, requestedAsOf, requestedAsOf];
  for (const { name, value } of parsedFilters) {
    if (!value) continue;
    where.push(`${columnByFilter[name]} = ?`);
    bindings.push(value);
  }

  const rosterResult = await c.env.DB.prepare(
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
       assigned_member.rank AS member_rank,
       CASE WHEN EXISTS (
         SELECT 1
         FROM position_staffing_bindings binding
         JOIN rule_book_position_participation participation
           ON participation.position_id = binding.position_id
           AND participation.template_version = binding.template_version
         JOIN rule_books rule_book ON rule_book.version = participation.rule_book_version
         WHERE binding.staffing_position_id = sp.id
           AND binding.review_status = 'approved'
           AND participation.bid_participation = 'ADMIN_ASSIGNED_NON_BIDDABLE'
           AND rule_book.status = 'active'
       ) THEN 1 ELSE 0 END AS administrative_assignment
     FROM staffing_positions sp
     LEFT JOIN member_assignments assignment_record
       ON assignment_record.id = (
         SELECT candidate.id
         FROM member_assignments candidate
         WHERE candidate.staffing_position_id = sp.id
           AND candidate.status IN ('planned', 'active')
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

  const unassignedResult = await c.env.DB.prepare(
    `SELECT id, employee_id, first_name, last_name, rank, bid_category
     FROM members member_record
     WHERE NOT EXISTS (
       SELECT 1
       FROM member_assignments assignment_record
       WHERE assignment_record.member_id = member_record.id
         AND assignment_record.status IN ('planned', 'active')
         AND assignment_record.effective_from <= ?
         AND (assignment_record.effective_to IS NULL OR assignment_record.effective_to >= ?)
     )
     ORDER BY last_name, first_name, id`,
  )
    .bind(requestedAsOf, requestedAsOf)
    .all();
  const unassignedRows = unassignedResult.results as unknown as UnassignedMemberDbRow[];

  const positions = rosterRows.map((row) => ({
    id: row.id,
    stableSlotKey: row.stable_slot_key,
    division: row.division,
    shift: row.shift,
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
  return c.json({
    asOf: requestedAsOf,
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
  });
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
