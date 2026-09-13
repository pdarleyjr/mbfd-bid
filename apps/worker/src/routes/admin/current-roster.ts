import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';

import { createCsvStream } from '../../lib/csv-stream.js';
import { operationalDate } from '../../lib/operational-date.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

import {
  type DepartmentRosterPosition,
  type DepartmentRosterProjection,
  isCalendarDate,
  loadDepartmentRosterProjection,
} from '../../lib/department-roster.js';

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

type CurrentRosterPosition = DepartmentRosterPosition & { administrativeAssignment: boolean };
interface CurrentRosterProjection
  extends Omit<
    DepartmentRosterProjection,
    'positions' | 'summary' | 'unassignedMembers' | 'updatedAt'
  > {
  administrativeAssignmentPolicy: {
    status: 'configured' | 'unconfigured';
    bidYear: number;
    ruleBookVersion: string | null;
  };
  positions: CurrentRosterPosition[];
  summary: DepartmentRosterProjection['summary'] & {
    administrativelyAssignedNonBiddablePositions: number;
  };
  unassignedMembers: Array<
    DepartmentRosterProjection['unassignedMembers'][number] & { bidCategory: string }
  >;
}
export { canonicalRosterShift } from '../../lib/department-roster.js';

/** Compatibility for Bid board/history/export consumers; Department itself has no annual policy dependency. */
export async function loadCurrentRosterProjection(
  db: D1Database,
  requestedAsOf: string,
  filterInputs: ReadonlyArray<{ name: string; value: string | undefined }>,
): Promise<{ ok: true; projection: CurrentRosterProjection } | { ok: false; error: string }> {
  const result = await loadDepartmentRosterProjection(db, requestedAsOf, filterInputs);
  if (!result.ok) return result;
  const bidYear = Number.parseInt(requestedAsOf.slice(0, 4), 10);
  const policy = await db
    .prepare('SELECT rule_book_version FROM bid_years WHERE year = ? LIMIT 1')
    .bind(bidYear)
    .first<{ rule_book_version: string | null }>();
  const ruleBookVersion = policy?.rule_book_version ?? null;
  const participation = await db
    .prepare(`SELECT DISTINCT binding.staffing_position_id AS id
    FROM position_staffing_bindings binding
    JOIN rule_book_position_participation participation
      ON participation.position_id = binding.position_id AND participation.template_version = binding.template_version
    WHERE binding.review_status = 'approved' AND participation.rule_book_version = ?
      AND participation.bid_participation = 'ADMIN_ASSIGNED_NON_BIDDABLE'`)
    .bind(ruleBookVersion)
    .all<{ id: string }>();
  const administrativeIds = new Set(participation.results.map((row) => row.id));
  const categories = await db
    .prepare('SELECT id, bid_category FROM members')
    .all<{ id: number; bid_category: string }>();
  const categoryByMember = new Map(categories.results.map((row) => [row.id, row.bid_category]));
  const {
    updatedAt: _updatedAt,
    organizationUnits: _organizationUnits,
    ...department
  } = result.projection;
  const positions = department.positions.map(({ organization: _organization, ...position }) => ({
    ...position,
    administrativeAssignment: administrativeIds.has(position.id),
  }));
  return {
    ok: true,
    projection: {
      ...department,
      administrativeAssignmentPolicy: {
        status: ruleBookVersion === null ? 'unconfigured' : 'configured',
        bidYear,
        ruleBookVersion,
      },
      positions,
      summary: {
        ...department.summary,
        administrativelyAssignedNonBiddablePositions: positions.filter(
          (position) => position.administrativeAssignment,
        ).length,
      },
      unassignedMembers: department.unassignedMembers.map((member) => {
        const bidCategory = categoryByMember.get(member.id);
        if (bidCategory === undefined) throw new Error('member_changed_during_roster_read');
        return { ...member, bidCategory };
      }),
    },
  };
}

function requestProjectionInput(c: { req: { query(name: string): string | undefined } }):
  | {
      requestedAsOf: string;
      filterInputs: ReadonlyArray<{ name: string; value: string | undefined }>;
    }
  | { error: string } {
  const requestedAsOf = c.req.query('as_of') ?? operationalDate();
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
