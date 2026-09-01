import type { JwtPayload } from '@mbfd/shared';
import { type Context, Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import {
  EMPLOYMENT_STATUSES,
  type EmploymentStatus,
  type LifecycleEventDraft,
  type LifecycleMemberProjection,
  MEMBER_RANKS,
  type MemberRank,
  PERSONNEL_LIFECYCLE_KINDS,
  type PersonnelAssignmentState,
  type PersonnelLifecycleKind,
  type PersonnelMemberState,
  derivePersonnelMemberAsOf,
  isIsoCalendarDate,
  planPersonnelLifecycleChange,
} from '../../lib/personnel-lifecycle.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

type PositionReviewStatus = 'draft' | 'approved' | 'retired';

interface MemberDbRow {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  rank: MemberRank;
  bid_category: string;
  rsc_seniority: number;
  rank_seniority: number | null;
  hired_at: string | null;
  promoted_at: string | null;
  is_probationary: number;
  employment_status: EmploymentStatus;
  employment_status_effective_on: string | null;
  separation_type: string | null;
  created_at: number;
  updated_at: number;
}

interface AssignmentDbRow {
  id: string;
  member_id: number;
  staffing_position_id: string;
  status: PersonnelAssignmentState['status'];
  effective_from: string;
  effective_to: string | null;
}

interface StaffingPositionDbRow {
  id: string;
  stable_slot_key: string;
  division: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
  position_name: string | null;
  applicable_rank: string | null;
  active_from: string | null;
  active_to: string | null;
  review_status: PositionReviewStatus;
  created_at: number;
  updated_at: number;
}

interface LifecycleEventDbRow {
  id: string;
  member_id: number | null;
  staffing_position_id: string | null;
  member_assignment_id: string | null;
  kind: PersonnelLifecycleKind;
  effective_on: string;
  employment_status_before: EmploymentStatus | null;
  employment_status_after: EmploymentStatus | null;
  rank_before: MemberRank | null;
  rank_after: MemberRank | null;
  separation_type: string | null;
  reason: string;
  origin: string;
  actor_subject: string;
  idempotency_key: string;
  before_state: string;
  after_state: string;
  supersedes_event_id: string | null;
  created_at: number;
  event_employee_id?: string | null;
}

interface SupersededLifecycleEventDbRow {
  member_id: number | null;
  staffing_position_id: string | null;
}

interface ProjectedMemberDbRow extends MemberDbRow {
  projected_rank: MemberRank;
  projected_employment_status: EmploymentStatus;
  projected_employment_status_effective_on: string | null;
  projected_separation_type: string | null;
}

const RankSchema = z.enum(MEMBER_RANKS);
const EmploymentStatusSchema = z.enum(EMPLOYMENT_STATUSES);
const LifecycleKindSchema = z.enum(PERSONNEL_LIFECYCLE_KINDS);

const NewMemberSchema = z
  .object({
    employee_id: z.string().trim().min(1).max(128),
    first_name: z.string().trim().min(1).max(128),
    last_name: z.string().trim().min(1).max(128),
    rank: RankSchema,
    bid_category: z.enum(['OFC', 'FF', 'EXCLUDED']),
    rsc_seniority: z.number().int().nonnegative(),
    rank_seniority: z.number().int().nonnegative().nullable().optional(),
    hired_at: z.string().optional(),
  })
  .strict();

const StaffingPositionCreateSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    stable_slot_key: z.string().trim().min(1).max(256),
    division: z.string().trim().max(128).nullable().optional(),
    shift: z.string().trim().max(32).nullable().optional(),
    station: z.string().trim().max(128).nullable().optional(),
    unit: z.string().trim().max(128).nullable().optional(),
    position_name: z.string().trim().max(256).nullable().optional(),
    applicable_rank: RankSchema.nullable().optional(),
    active_from: z.string().optional(),
  })
  .strict();

const PersonnelChangeSchema = z
  .object({
    kind: LifecycleKindSchema,
    member_id: z.number().int().positive().optional(),
    new_member: NewMemberSchema.optional(),
    staffing_position_id: z.string().trim().min(1).max(128).optional(),
    staffing_position: StaffingPositionCreateSchema.optional(),
    rank_after: RankSchema.optional(),
    employment_status_after: EmploymentStatusSchema.optional(),
    separation_type: z.string().trim().min(1).max(256).optional(),
    effective_on: z.string(),
    reason: z.string(),
    supersedes_event_id: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

type PersonnelChangeBody = z.infer<typeof PersonnelChangeSchema>;

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function priorCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapMember(row: MemberDbRow) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    firstName: row.first_name,
    lastName: row.last_name,
    rank: row.rank,
    bidCategory: row.bid_category,
    rscSeniority: row.rsc_seniority,
    rankSeniority: row.rank_seniority,
    hiredAt: row.hired_at,
    promotedAt: row.promoted_at,
    isProbationary: row.is_probationary === 1,
    employmentStatus: row.employment_status,
    employmentStatusEffectiveOn: row.employment_status_effective_on,
    separationType: row.separation_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectedMember(row: ProjectedMemberDbRow) {
  return {
    ...mapMember(row),
    rank: row.projected_rank,
    employmentStatus: row.projected_employment_status,
    employmentStatusEffectiveOn: row.projected_employment_status_effective_on,
    separationType: row.projected_separation_type,
  };
}

function mapAssignment(row: AssignmentDbRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    staffingPositionId: row.staffing_position_id,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

function mapEvent(row: LifecycleEventDbRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    staffingPositionId: row.staffing_position_id,
    memberAssignmentId: row.member_assignment_id,
    kind: row.kind,
    effectiveOn: row.effective_on,
    employmentStatusBefore: row.employment_status_before,
    employmentStatusAfter: row.employment_status_after,
    rankBefore: row.rank_before,
    rankAfter: row.rank_after,
    separationType: row.separation_type,
    reason: row.reason,
    origin: row.origin,
    actorSubject: row.actor_subject,
    idempotencyKey: row.idempotency_key,
    beforeState: safeJsonObject(row.before_state),
    afterState: safeJsonObject(row.after_state),
    supersedesEventId: row.supersedes_event_id,
    createdAt: row.created_at,
  };
}

function toMemberState(row: MemberDbRow): PersonnelMemberState {
  return {
    id: row.id,
    employeeId: row.employee_id,
    firstName: row.first_name,
    lastName: row.last_name,
    rank: row.rank,
    employmentStatus: row.employment_status,
    employmentStatusEffectiveOn: row.employment_status_effective_on,
    separationType: row.separation_type,
  };
}

function toAssignmentState(row: AssignmentDbRow): PersonnelAssignmentState {
  return {
    id: row.id,
    memberId: row.member_id,
    staffingPositionId: row.staffing_position_id,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

async function first<T>(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<T | undefined> {
  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all();
  return result.results[0] as unknown as T | undefined;
}

async function all<T>(db: D1Database, query: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all();
  return result.results as unknown as T[];
}

function eventStatement(
  db: D1Database,
  input: {
    id: string;
    memberId: number | null;
    memberEmployeeId: string | null;
    staffingPositionId: string | null;
    memberAssignmentId: string | null;
    event: LifecycleEventDraft;
    createdAt: number;
  },
): D1PreparedStatement {
  const memberIdSql =
    input.memberEmployeeId === null
      ? '?'
      : '(SELECT id FROM members WHERE employee_id = ? LIMIT 1)';
  const memberBinding = input.memberEmployeeId ?? input.memberId;
  return db
    .prepare(
      `INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       VALUES (?, ${memberIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      memberBinding,
      input.staffingPositionId,
      input.memberAssignmentId,
      input.event.kind,
      input.event.effectiveOn,
      input.event.employmentStatusBefore,
      input.event.employmentStatusAfter,
      input.event.rankBefore,
      input.event.rankAfter,
      input.event.separationType,
      input.event.reason,
      input.event.origin,
      input.event.actorSubject,
      input.event.idempotencyKey,
      JSON.stringify(input.event.beforeState),
      JSON.stringify(input.event.afterState),
      input.event.supersedesEventId,
      input.createdAt,
    );
}

function positionIsUsableAt(position: StaffingPositionDbRow, effectiveOn: string): boolean {
  return (
    position.review_status === 'approved' &&
    (position.active_from === null || position.active_from <= effectiveOn) &&
    (position.active_to === null || position.active_to >= effectiveOn)
  );
}

function sameNullableValue(actual: unknown, expected: unknown): boolean {
  return (actual ?? null) === (expected ?? null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sameReceipt(
  existing: LifecycleEventDbRow,
  body: PersonnelChangeBody,
  actorSubject: string,
): boolean {
  const sameMember =
    body.new_member === undefined
      ? existing.member_id === (body.member_id ?? null)
      : body.member_id === undefined && body.new_member.employee_id === existing.event_employee_id;
  const expectedPositionId = body.staffing_position_id ?? body.staffing_position?.id ?? null;
  const expectedEmploymentStatus =
    body.kind === 'NEW_HIRE' || body.kind === 'REACTIVATION'
      ? 'active'
      : body.kind === 'RETIREMENT'
        ? 'retired'
        : body.kind === 'SEPARATION'
          ? 'separated'
          : body.employment_status_after;
  const expectedRank = body.rank_after ?? body.new_member?.rank;
  const afterState = safeJsonObject(existing.after_state);
  const existingHasNewMember = typeof afterState.employeeId === 'string';
  const sameNewMember =
    body.new_member === undefined
      ? !existingHasNewMember
      : existingHasNewMember &&
        afterState.employeeId === body.new_member.employee_id &&
        afterState.firstName === body.new_member.first_name &&
        afterState.lastName === body.new_member.last_name &&
        afterState.bidCategory === body.new_member.bid_category &&
        afterState.rscSeniority === body.new_member.rsc_seniority &&
        sameNullableValue(afterState.rankSeniority, body.new_member.rank_seniority) &&
        sameNullableValue(afterState.hiredAt, body.new_member.hired_at ?? body.effective_on);
  const staffingPositionAfterState = asRecord(afterState.staffingPosition);
  const samePositionCreate =
    body.staffing_position === undefined
      ? existing.kind !== 'POSITION_CREATE'
      : existing.kind === 'POSITION_CREATE' &&
        staffingPositionAfterState !== null &&
        sameNullableValue(staffingPositionAfterState.id, body.staffing_position.id) &&
        sameNullableValue(
          staffingPositionAfterState.stable_slot_key,
          body.staffing_position.stable_slot_key,
        ) &&
        sameNullableValue(staffingPositionAfterState.division, body.staffing_position.division) &&
        sameNullableValue(staffingPositionAfterState.shift, body.staffing_position.shift) &&
        sameNullableValue(staffingPositionAfterState.station, body.staffing_position.station) &&
        sameNullableValue(staffingPositionAfterState.unit, body.staffing_position.unit) &&
        sameNullableValue(
          staffingPositionAfterState.position_name,
          body.staffing_position.position_name,
        ) &&
        sameNullableValue(
          staffingPositionAfterState.applicable_rank,
          body.staffing_position.applicable_rank,
        ) &&
        sameNullableValue(
          staffingPositionAfterState.activeFrom,
          body.staffing_position.active_from ?? body.effective_on,
        );
  return (
    sameMember &&
    sameNewMember &&
    samePositionCreate &&
    existing.kind === body.kind &&
    existing.staffing_position_id === expectedPositionId &&
    existing.effective_on === body.effective_on &&
    existing.reason === body.reason.trim() &&
    (expectedRank === undefined || existing.rank_after === expectedRank) &&
    (expectedEmploymentStatus === undefined ||
      existing.employment_status_after === expectedEmploymentStatus) &&
    existing.separation_type === (body.separation_type ?? null) &&
    existing.supersedes_event_id === (body.supersedes_event_id ?? null) &&
    existing.actor_subject === actorSubject
  );
}

async function existingReceipt(
  db: D1Database,
  idempotencyKey: string,
): Promise<LifecycleEventDbRow | undefined> {
  return first<LifecycleEventDbRow>(
    db,
    `SELECT event.*, member.employee_id AS event_employee_id
     FROM personnel_lifecycle_events event
     LEFT JOIN members member ON member.id = event.member_id
     WHERE event.idempotency_key = ?`,
    idempotencyKey,
  );
}

type SupersessionValidation =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'supersedes_event_not_found'
        | 'superseded_event_member_mismatch'
        | 'superseded_event_target_mismatch';
    };

/**
 * A correction records evidence about one member.  It must never become a
 * cross-member or cross-slot rewrite simply because an operator supplied an
 * immutable event ID.  A targetless correction does not alter placement; a
 * target-bearing correction must use the same target as its source evidence.
 */
async function validateSupersededEvent(
  db: D1Database,
  memberId: number,
  body: PersonnelChangeBody,
): Promise<SupersessionValidation> {
  const supersedesEventId = body.supersedes_event_id;
  if (supersedesEventId === undefined) return { ok: true };
  const superseded = await first<SupersededLifecycleEventDbRow>(
    db,
    `SELECT member_id, staffing_position_id
     FROM personnel_lifecycle_events
     WHERE id = ?`,
    supersedesEventId,
  );
  if (superseded === undefined) return { ok: false, error: 'supersedes_event_not_found' };
  if (superseded.member_id !== memberId) {
    return { ok: false, error: 'superseded_event_member_mismatch' };
  }
  if (
    body.staffing_position_id !== undefined &&
    superseded.staffing_position_id !== body.staffing_position_id
  ) {
    return { ok: false, error: 'superseded_event_target_mismatch' };
  }
  return { ok: true };
}

async function loadMember(db: D1Database, memberId: number): Promise<MemberDbRow | undefined> {
  return first<MemberDbRow>(db, 'SELECT * FROM members WHERE id = ?', memberId);
}

/**
 * Future-dated writes must be planned from the state that will actually exist
 * on their effective date. Reading only `members` would let a later promotion
 * reuse today's active row after an already-scheduled retirement.
 */
async function loadMemberAsOf(
  db: D1Database,
  memberId: number,
  asOf: string,
): Promise<MemberDbRow | undefined> {
  const [member, events] = await Promise.all([
    loadMember(db, memberId),
    all<LifecycleEventDbRow>(
      db,
      `SELECT * FROM personnel_lifecycle_events
       WHERE member_id = ?
       ORDER BY effective_on ASC, created_at ASC, id ASC`,
      memberId,
    ),
  ]);
  if (member === undefined) return undefined;
  const projected = derivePersonnelMemberAsOf(
    toMemberState(member),
    events.map((event) => ({
      id: event.id,
      kind: event.kind,
      effectiveOn: event.effective_on,
      employmentStatusAfter: event.employment_status_after,
      rankAfter: event.rank_after,
      separationType: event.separation_type,
      beforeState: event.before_state,
      createdAt: event.created_at,
    })),
    asOf,
  );
  return {
    ...member,
    rank: projected.rank,
    employment_status: projected.employmentStatus,
    employment_status_effective_on: projected.employmentStatusEffectiveOn,
    separation_type: projected.separationType,
  };
}

async function loadPosition(
  db: D1Database,
  staffingPositionId: string,
): Promise<StaffingPositionDbRow | undefined> {
  return first<StaffingPositionDbRow>(
    db,
    'SELECT * FROM staffing_positions WHERE id = ?',
    staffingPositionId,
  );
}

router.get('/summary', async (c) => {
  const asOf = c.req.query('as_of') ?? todayUtc();
  if (!isIsoCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);

  // Future-effective lifecycle events are not prematurely written into the
  // member projection. Every personnel read derives its as-of state from the
  // immutable ledger, so the status changes on the effective boundary without
  // a scheduler or a destructive historical rewrite.
  const statuses = await all<{ employment_status: EmploymentStatus; count: number }>(
    c.env.DB,
    `SELECT projected_status AS employment_status, count(*) AS count
     FROM (
       SELECT COALESCE(
         (SELECT lifecycle_event.employment_status_after
          FROM personnel_lifecycle_events lifecycle_event
          WHERE lifecycle_event.member_id = member_record.id
            AND lifecycle_event.effective_on <= ?
          ORDER BY lifecycle_event.effective_on DESC, lifecycle_event.created_at DESC, lifecycle_event.id DESC
          LIMIT 1),
         member_record.employment_status
       ) AS projected_status
       FROM members member_record
     )
     GROUP BY projected_status`,
    asOf,
  );
  const counts = Object.fromEntries(
    statuses.map((row) => [row.employment_status, Number(row.count)]),
  ) as Partial<Record<EmploymentStatus, number>>;
  const upcoming = await first<{ count: number }>(
    c.env.DB,
    'SELECT count(*) AS count FROM personnel_lifecycle_events WHERE effective_on > ?',
    asOf,
  );
  const openAssignments = await first<{ count: number }>(
    c.env.DB,
    `SELECT count(*) AS count
     FROM member_assignments
     WHERE status <> 'cancelled'
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)`,
    asOf,
    asOf,
  );
  return c.json({
    asOf,
    members: {
      active: counts.active ?? 0,
      inactive: counts.inactive ?? 0,
      retired: counts.retired ?? 0,
      separated: counts.separated ?? 0,
      unclassified: counts.unknown ?? 0,
    },
    activeAssignments: Number(openAssignments?.count ?? 0),
    upcomingChanges: Number(upcoming?.count ?? 0),
  });
});

router.get('/members', async (c) => {
  const status = c.req.query('employment_status');
  if (status !== undefined && !(EMPLOYMENT_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: 'invalid_employment_status' }, 400);
  }
  const asOf = c.req.query('as_of') ?? todayUtc();
  if (!isIsoCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
  const limitInput = Number(c.req.query('limit') ?? '100');
  const limit = Number.isInteger(limitInput) ? Math.min(500, Math.max(1, limitInput)) : 100;
  const selectProjection = `SELECT member_record.*,
      COALESCE(lifecycle_event.rank_after, member_record.rank) AS projected_rank,
      COALESCE(lifecycle_event.employment_status_after, member_record.employment_status) AS projected_employment_status,
      CASE
        WHEN lifecycle_event.kind IN ('NEW_HIRE', 'REACTIVATION', 'RETIREMENT', 'SEPARATION', 'CORRECTION')
          THEN lifecycle_event.effective_on
        ELSE member_record.employment_status_effective_on
      END AS projected_employment_status_effective_on,
      CASE
        WHEN lifecycle_event.employment_status_after IN ('retired', 'separated')
          THEN lifecycle_event.separation_type
        WHEN lifecycle_event.kind IN ('NEW_HIRE', 'REACTIVATION', 'CORRECTION')
          THEN NULL
        ELSE member_record.separation_type
      END AS projected_separation_type
     FROM members member_record
     LEFT JOIN personnel_lifecycle_events lifecycle_event
       ON lifecycle_event.id = (
         SELECT candidate.id
         FROM personnel_lifecycle_events candidate
         WHERE candidate.member_id = member_record.id
           AND candidate.effective_on <= ?
         ORDER BY candidate.effective_on DESC, candidate.created_at DESC, candidate.id DESC
         LIMIT 1
       )`;
  const rows =
    status === undefined
      ? await all<ProjectedMemberDbRow>(
          c.env.DB,
          `${selectProjection} ORDER BY member_record.last_name, member_record.first_name, member_record.id LIMIT ?`,
          asOf,
          limit,
        )
      : await all<ProjectedMemberDbRow>(
          c.env.DB,
          `${selectProjection}
           WHERE COALESCE(lifecycle_event.employment_status_after, member_record.employment_status) = ?
           ORDER BY member_record.last_name, member_record.first_name, member_record.id LIMIT ?`,
          asOf,
          status,
          limit,
        );
  return c.json({ asOf, members: rows.map(mapProjectedMember), count: rows.length });
});

router.get('/members/:memberId{\\d+}/history', async (c) => {
  const memberId = Number(c.req.param('memberId'));
  const member = await loadMember(c.env.DB, memberId);
  if (member === undefined) return c.json({ error: 'not_found' }, 404);
  const [events, assignments] = await Promise.all([
    all<LifecycleEventDbRow>(
      c.env.DB,
      `SELECT * FROM personnel_lifecycle_events
       WHERE member_id = ?
       ORDER BY effective_on DESC, created_at DESC, id DESC`,
      memberId,
    ),
    all<AssignmentDbRow>(
      c.env.DB,
      `SELECT id, member_id, staffing_position_id, status, effective_from, effective_to
       FROM member_assignments
       WHERE member_id = ?
       ORDER BY effective_from DESC, created_at DESC, id DESC`,
      memberId,
    ),
  ]);
  return c.json({
    member: mapMember(member),
    lifecycleEvents: events.map(mapEvent),
    assignments: assignments.map(mapAssignment),
  });
});

router.get('/changes', async (c) => {
  const rawMemberId = c.req.query('member_id');
  const requestedMemberId = rawMemberId === undefined ? null : Number(rawMemberId);
  if (
    rawMemberId !== undefined &&
    (!Number.isInteger(requestedMemberId) || requestedMemberId === null || requestedMemberId <= 0)
  ) {
    return c.json({ error: 'invalid_member_id' }, 400);
  }
  const events =
    requestedMemberId === null
      ? await all<LifecycleEventDbRow>(
          c.env.DB,
          'SELECT * FROM personnel_lifecycle_events ORDER BY effective_on DESC, created_at DESC, id DESC LIMIT 200',
        )
      : await all<LifecycleEventDbRow>(
          c.env.DB,
          `SELECT * FROM personnel_lifecycle_events
           WHERE member_id = ?
           ORDER BY effective_on DESC, created_at DESC, id DESC LIMIT 200`,
          requestedMemberId,
        );
  return c.json({ changes: events.map(mapEvent), count: events.length });
});

/** Side-effect-free preview for the supported permanent lifecycle operations. */
router.post('/changes/preview', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = PersonnelChangeSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  if (!isIsoCalendarDate(body.effective_on) || body.member_id === undefined) {
    return c.json({ error: 'preview_requires_supported_member_change' }, 422);
  }
  if (
    body.kind === 'NEW_HIRE' ||
    body.kind === 'POSITION_CREATE' ||
    body.kind === 'POSITION_RETIRE'
  ) {
    return c.json({ error: 'preview_requires_supported_member_change' }, 422);
  }
  const member = await loadMember(c.env.DB, body.member_id);
  if (member === undefined) return c.json({ error: 'member_not_found' }, 404);
  const assignments = await all<AssignmentDbRow>(
    c.env.DB,
    `SELECT id, member_id, staffing_position_id, status, effective_from, effective_to
       FROM member_assignments WHERE member_id = ?`,
    member.id,
  );
  const plan = planPersonnelLifecycleChange({
    kind: body.kind,
    effectiveOn: body.effective_on,
    reason: body.reason,
    actorSubject: String(c.get('claims').sub ?? 'preview'),
    idempotencyKey: 'preview-only',
    member: toMemberState(member),
    activeAssignments: assignments.map(toAssignmentState),
    staffingPositionId: body.staffing_position_id,
    rankAfter: body.rank_after,
    separationType: body.separation_type,
    employmentStatusAfter: body.employment_status_after,
    supersedesEventId: body.supersedes_event_id,
    nowOn: todayUtc(),
    eventId: 'preview-only',
  });
  if (!plan.ok) return c.json({ error: plan.error }, 422);
  const targetOccupant =
    body.staffing_position_id === undefined
      ? null
      : await first<{ member_id: number }>(
          c.env.DB,
          `SELECT member_id FROM member_assignments WHERE staffing_position_id = ? AND status <> 'cancelled'
       AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) LIMIT 1`,
          body.staffing_position_id,
          body.effective_on,
          body.effective_on,
        );
  return c.json({
    preview: true,
    current: { member: mapMember(member), assignments: assignments.map(mapAssignment) },
    proposed: plan,
    vacancyImpact:
      targetOccupant === undefined
        ? 'KNOWN_VACANT'
        : targetOccupant.member_id === member.id
          ? 'CURRENT_MEMBER_OCCUPIES_TARGET'
          : 'KNOWN_OCCUPIED',
    qualificationImpact: 'NOT_DETERMINED_BY_PERSONNEL_PREVIEW',
    establishedBidSnapshotImpact: 'NONE',
  });
});

async function ensureTargetPositionAvailable(
  db: D1Database,
  body: PersonnelChangeBody,
  memberId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const positionId = body.staffing_position_id;
  if (positionId === undefined) return { ok: true };
  const position = await loadPosition(db, positionId);
  if (position === undefined) return { ok: false, error: 'staffing_position_not_found' };
  if (body.kind !== 'VACATE' && !positionIsUsableAt(position, body.effective_on)) {
    return { ok: false, error: 'staffing_position_unavailable' };
  }
  const occupant = await first<{ member_id: number }>(
    db,
    `SELECT member_id FROM member_assignments
     WHERE staffing_position_id = ?
       AND status <> 'cancelled'
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY effective_from DESC, created_at DESC, id DESC
     LIMIT 1`,
    positionId,
    body.effective_on,
    body.effective_on,
  );
  if (occupant !== undefined && occupant.member_id !== memberId) {
    return { ok: false, error: 'staffing_position_occupied' };
  }
  return { ok: true };
}

function memberUpdateStatement(
  db: D1Database,
  memberId: number,
  projection: LifecycleMemberProjection,
  now: number,
): D1PreparedStatement | null {
  const updates: string[] = [];
  const bindings: unknown[] = [];
  if (projection.employmentStatus !== undefined) {
    updates.push('employment_status = ?');
    bindings.push(projection.employmentStatus);
  }
  if (projection.employmentStatusEffectiveOn !== undefined) {
    updates.push('employment_status_effective_on = ?');
    bindings.push(projection.employmentStatusEffectiveOn);
  }
  if (projection.separationType !== undefined) {
    updates.push('separation_type = ?');
    bindings.push(projection.separationType);
  }
  if (projection.rank !== undefined) {
    updates.push('rank = ?');
    bindings.push(projection.rank);
  }
  if (projection.promotedAt !== undefined) {
    updates.push('promoted_at = ?');
    bindings.push(projection.promotedAt);
  }
  if (updates.length === 0) return null;
  updates.push('updated_at = ?');
  bindings.push(now, memberId);
  return db.prepare(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings);
}

async function createOrRetirePosition(
  c: Context<AdminEnv>,
  body: PersonnelChangeBody,
  idempotencyKey: string,
): Promise<Response> {
  const now = Date.now();
  const actorSubject = String(c.get('claims').sub ?? '');
  if (actorSubject.length === 0) return c.json({ error: 'invalid_actor_subject' }, 400);
  if (body.kind === 'POSITION_CREATE') {
    if (body.staffing_position === undefined)
      return c.json({ error: 'staffing_position_required' }, 400);
    if (body.member_id !== undefined || body.new_member !== undefined) {
      return c.json({ error: 'position_change_cannot_include_member' }, 400);
    }
    const position = body.staffing_position;
    if (position.active_from !== undefined && !isIsoCalendarDate(position.active_from)) {
      return c.json({ error: 'invalid_active_from' }, 400);
    }
    const existing = await loadPosition(c.env.DB, position.id);
    if (existing !== undefined) return c.json({ error: 'staffing_position_exists' }, 409);
    const existingKey = await first<{ id: string }>(
      c.env.DB,
      'SELECT id FROM staffing_positions WHERE stable_slot_key = ?',
      position.stable_slot_key,
    );
    if (existingKey !== undefined) return c.json({ error: 'stable_slot_key_exists' }, 409);

    const eventId = ulid();
    const event: LifecycleEventDraft = {
      kind: 'POSITION_CREATE',
      effectiveOn: body.effective_on,
      employmentStatusBefore: 'unknown',
      employmentStatusAfter: 'unknown',
      rankBefore: 'FF',
      rankAfter: 'FF',
      separationType: null,
      reason: body.reason.trim(),
      origin: 'ADMIN',
      actorSubject,
      idempotencyKey,
      beforeState: { staffingPosition: null },
      afterState: {
        staffingPosition: { ...position, activeFrom: position.active_from ?? body.effective_on },
      },
      supersedesEventId: body.supersedes_event_id ?? null,
    };
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO staffing_positions
             (id, stable_slot_key, division, shift, station, unit, position_name,
              applicable_rank, active_from, review_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      ).bind(
        position.id,
        position.stable_slot_key,
        position.division ?? null,
        position.shift ?? null,
        position.station ?? null,
        position.unit ?? null,
        position.position_name ?? null,
        position.applicable_rank ?? null,
        position.active_from ?? body.effective_on,
        now,
        now,
      ),
      eventStatement(c.env.DB, {
        id: eventId,
        memberId: null,
        memberEmployeeId: null,
        staffingPositionId: position.id,
        memberAssignmentId: null,
        event,
        createdAt: now,
      }),
    ]);
    const created = await loadPosition(c.env.DB, position.id);
    const savedEvent = await first<LifecycleEventDbRow>(
      c.env.DB,
      'SELECT * FROM personnel_lifecycle_events WHERE id = ?',
      eventId,
    );
    return c.json(
      { replayed: false, staffingPosition: created, event: savedEvent && mapEvent(savedEvent) },
      201,
    );
  }

  if (body.kind === 'POSITION_RETIRE') {
    if (body.staffing_position_id === undefined)
      return c.json({ error: 'staffing_position_required' }, 400);
    if (body.member_id !== undefined || body.new_member !== undefined) {
      return c.json({ error: 'position_change_cannot_include_member' }, 400);
    }
    const position = await loadPosition(c.env.DB, body.staffing_position_id);
    if (position === undefined) return c.json({ error: 'staffing_position_not_found' }, 404);
    const occupied = await first<{ id: string }>(
      c.env.DB,
      `SELECT id FROM member_assignments
       WHERE staffing_position_id = ?
         AND status <> 'cancelled'
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       LIMIT 1`,
      position.id,
      body.effective_on,
      body.effective_on,
    );
    if (occupied !== undefined) return c.json({ error: 'position_occupied_requires_vacancy' }, 409);

    const eventId = ulid();
    const event: LifecycleEventDraft = {
      kind: 'POSITION_RETIRE',
      effectiveOn: body.effective_on,
      employmentStatusBefore: 'unknown',
      employmentStatusAfter: 'unknown',
      rankBefore: 'FF',
      rankAfter: 'FF',
      separationType: null,
      reason: body.reason.trim(),
      origin: 'ADMIN',
      actorSubject,
      idempotencyKey,
      beforeState: { staffingPosition: position },
      afterState: {
        staffingPosition: {
          ...position,
          reviewStatus: 'retired',
          activeTo: priorCalendarDate(body.effective_on),
        },
      },
      supersedesEventId: body.supersedes_event_id ?? null,
    };
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE staffing_positions SET review_status = ?, active_to = ?, updated_at = ? WHERE id = ?',
      ).bind('retired', priorCalendarDate(body.effective_on), now, position.id),
      eventStatement(c.env.DB, {
        id: eventId,
        memberId: null,
        memberEmployeeId: null,
        staffingPositionId: position.id,
        memberAssignmentId: null,
        event,
        createdAt: now,
      }),
    ]);
    const retired = await loadPosition(c.env.DB, position.id);
    const savedEvent = await first<LifecycleEventDbRow>(
      c.env.DB,
      'SELECT * FROM personnel_lifecycle_events WHERE id = ?',
      eventId,
    );
    return c.json(
      { replayed: false, staffingPosition: retired, event: savedEvent && mapEvent(savedEvent) },
      201,
    );
  }

  return c.json({ error: 'unsupported_position_change' }, 422);
}

router.post('/changes', requireStepUpAuth(), async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = PersonnelChangeSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  if (!isIsoCalendarDate(body.effective_on)) return c.json({ error: 'invalid_effective_on' }, 400);

  const idempotencyKey = c.req.header('Idempotency-Key');
  if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'idempotency_key_required' }, 400);
  }
  if (idempotencyKey !== idempotencyKey.trim() || idempotencyKey.length > 256) {
    return c.json({ error: 'invalid_idempotency_key' }, 400);
  }
  const actorSubject = String(c.get('claims').sub ?? '');
  if (actorSubject.length === 0) return c.json({ error: 'invalid_actor_subject' }, 400);
  const receipt = await existingReceipt(c.env.DB, idempotencyKey);
  if (receipt !== undefined) {
    if (sameReceipt(receipt, body, actorSubject)) {
      return c.json({ replayed: true, event: mapEvent(receipt) });
    }
    return c.json({ error: 'idempotency_key_reused' }, 409);
  }

  if (body.supersedes_event_id !== undefined && body.kind !== 'CORRECTION') {
    return c.json({ error: 'supersedes_event_correction_only' }, 422);
  }

  if (body.kind === 'POSITION_CREATE' || body.kind === 'POSITION_RETIRE') {
    return createOrRetirePosition(c, body, idempotencyKey);
  }
  const isNewHire = body.kind === 'NEW_HIRE';
  if (isNewHire && (body.new_member === undefined || body.member_id !== undefined)) {
    return c.json({ error: 'new_hire_requires_new_member' }, 400);
  }
  if (!isNewHire && (body.member_id === undefined || body.new_member !== undefined)) {
    return c.json({ error: 'member_id_required' }, 400);
  }

  const nowOn = todayUtc();
  const now = Date.now();
  const eventId = ulid();
  const assignmentId = ulid();

  let member: PersonnelMemberState;
  let memberId: number | null;
  let newMemberEmployeeId: string | null = null;
  let assignmentRows: AssignmentDbRow[] = [];
  if (isNewHire) {
    const newMember = body.new_member as z.infer<typeof NewMemberSchema>;
    if (newMember.hired_at !== undefined && !isIsoCalendarDate(newMember.hired_at)) {
      return c.json({ error: 'invalid_hired_at' }, 400);
    }
    const duplicate = await first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM members WHERE employee_id = ?',
      newMember.employee_id,
    );
    if (duplicate !== undefined) return c.json({ error: 'employee_id_exists' }, 409);
    member = {
      id: 0,
      employeeId: newMember.employee_id,
      firstName: newMember.first_name,
      lastName: newMember.last_name,
      rank: newMember.rank,
      employmentStatus: 'unknown',
      employmentStatusEffectiveOn: null,
      separationType: null,
    };
    memberId = null;
    newMemberEmployeeId = newMember.employee_id;
  } else {
    const existing = await loadMemberAsOf(c.env.DB, body.member_id as number, body.effective_on);
    if (existing === undefined) return c.json({ error: 'member_not_found' }, 404);
    member = toMemberState(existing);
    memberId = existing.id;
    assignmentRows = await all<AssignmentDbRow>(
      c.env.DB,
      `SELECT id, member_id, staffing_position_id, status, effective_from, effective_to
       FROM member_assignments
       WHERE member_id = ? AND status <> 'cancelled'`,
      existing.id,
    );
  }

  if (body.supersedes_event_id !== undefined) {
    // The earlier correction-only guard means this branch has a canonical
    // existing member. Keep the check explicit so any later route expansion
    // fails closed rather than turning a source-event reference into a write.
    if (memberId === null) return c.json({ error: 'member_id_required' }, 400);
    const supersession = await validateSupersededEvent(c.env.DB, memberId, body);
    if (!supersession.ok) return c.json({ error: supersession.error }, 422);
  }

  const target = await ensureTargetPositionAvailable(c.env.DB, body, memberId);
  if (!target.ok)
    return c.json(
      { error: target.error },
      target.error === 'staffing_position_not_found' ? 404 : 409,
    );

  // A new-hire identity includes the initial rank. Accept that canonical value
  // when a non-UI client omitted the redundant rank_after field.
  const requestedRankAfter = body.rank_after ?? (isNewHire ? body.new_member?.rank : undefined);
  const lifecycleInput = {
    kind: body.kind,
    effectiveOn: body.effective_on,
    reason: body.reason,
    actorSubject,
    idempotencyKey,
    member,
    activeAssignments: assignmentRows.map(toAssignmentState),
    nowOn,
    ...(body.staffing_position_id === undefined
      ? {}
      : { staffingPositionId: body.staffing_position_id }),
    ...(requestedRankAfter === undefined ? {} : { rankAfter: requestedRankAfter }),
    ...(body.employment_status_after === undefined
      ? {}
      : { employmentStatusAfter: body.employment_status_after }),
    ...(body.separation_type === undefined ? {} : { separationType: body.separation_type }),
    ...(body.supersedes_event_id === undefined
      ? {}
      : { supersedesEventId: body.supersedes_event_id }),
    eventId,
  };
  const planned = planPersonnelLifecycleChange(lifecycleInput);
  if (!planned.ok) return c.json({ error: planned.error }, 422);

  const targetAssignmentId = planned.assignmentCreation === null ? null : assignmentId;
  const eventAssignmentId = targetAssignmentId ?? planned.assignmentClosures[0]?.id ?? null;
  const eventBeforeState = { ...planned.event.beforeState };
  const eventAfterState = { ...planned.event.afterState };
  if (isNewHire) {
    const newMember = body.new_member as z.infer<typeof NewMemberSchema>;
    eventBeforeState.memberId = null;
    eventAfterState.memberId = null;
    eventAfterState.employeeId = member.employeeId;
    eventAfterState.firstName = newMember.first_name;
    eventAfterState.lastName = newMember.last_name;
    eventAfterState.bidCategory = newMember.bid_category;
    eventAfterState.rscSeniority = newMember.rsc_seniority;
    eventAfterState.rankSeniority = newMember.rank_seniority ?? null;
    eventAfterState.hiredAt = newMember.hired_at ?? body.effective_on;
  }
  const event: LifecycleEventDraft = {
    ...planned.event,
    beforeState: eventBeforeState,
    afterState: eventAfterState,
  };

  const statements: D1PreparedStatement[] = [];
  if (isNewHire) {
    const newMember = body.new_member as z.infer<typeof NewMemberSchema>;
    const immediatelyActive = body.effective_on <= nowOn;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO members
             (employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
              rank_seniority, hired_at, is_probationary, employment_status,
              employment_status_effective_on, separation_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)`,
      ).bind(
        newMember.employee_id,
        newMember.first_name,
        newMember.last_name,
        newMember.rank,
        newMember.bid_category,
        newMember.rsc_seniority,
        newMember.rank_seniority ?? null,
        newMember.hired_at ?? body.effective_on,
        immediatelyActive ? 'active' : 'unknown',
        immediatelyActive ? body.effective_on : null,
        now,
        now,
      ),
    );
  } else if (memberId !== null && planned.memberProjection !== null) {
    const update = memberUpdateStatement(c.env.DB, memberId, planned.memberProjection, now);
    if (update !== null) statements.push(update);
  }

  for (const closure of planned.assignmentClosures) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE member_assignments
           SET status = ?, effective_to = ?, updated_at = ?
           WHERE id = ? AND status <> 'cancelled'`,
      ).bind(closure.status, closure.effectiveTo, now, closure.id),
    );
  }
  if (planned.assignmentCreation !== null) {
    const assignment = planned.assignmentCreation;
    if (newMemberEmployeeId === null) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO member_assignments
               (id, member_id, staffing_position_id, origin_type, origin_ref, status,
                effective_from, effective_to, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).bind(
          assignmentId,
          assignment.memberId,
          assignment.staffingPositionId,
          assignment.originType,
          assignment.originRef,
          assignment.status,
          assignment.effectiveFrom,
          now,
          now,
        ),
      );
    } else {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO member_assignments
               (id, member_id, staffing_position_id, origin_type, origin_ref, status,
                effective_from, effective_to, created_at, updated_at)
             SELECT ?, id, ?, ?, ?, ?, ?, NULL, ?, ?
             FROM members WHERE employee_id = ?`,
        ).bind(
          assignmentId,
          assignment.staffingPositionId,
          assignment.originType,
          assignment.originRef,
          assignment.status,
          assignment.effectiveFrom,
          now,
          now,
          newMemberEmployeeId,
        ),
      );
    }
  }
  statements.push(
    eventStatement(c.env.DB, {
      id: eventId,
      memberId,
      memberEmployeeId: newMemberEmployeeId,
      staffingPositionId: body.staffing_position_id ?? null,
      memberAssignmentId: eventAssignmentId,
      event,
      createdAt: now,
    }),
  );

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('idempotency_key'))
      return c.json({ error: 'idempotency_key_reused' }, 409);
    if (message.includes('overlapping authoritative assignment')) {
      return c.json({ error: 'personnel_assignment_overlap_conflict' }, 409);
    }
    console.error('personnel lifecycle batch failed', error);
    return c.json({ error: 'personnel_change_not_applied' }, 409);
  }

  const savedEvent = await first<LifecycleEventDbRow>(
    c.env.DB,
    'SELECT * FROM personnel_lifecycle_events WHERE id = ?',
    eventId,
  );
  const savedMember =
    memberId === null
      ? await first<MemberDbRow>(
          c.env.DB,
          'SELECT * FROM members WHERE employee_id = ?',
          newMemberEmployeeId,
        )
      : await loadMember(c.env.DB, memberId);
  return c.json(
    {
      replayed: false,
      event: savedEvent === undefined ? null : mapEvent(savedEvent),
      member: savedMember === undefined ? null : mapMember(savedMember),
      assignmentId: targetAssignmentId,
    },
    201,
  );
});

export default router;
