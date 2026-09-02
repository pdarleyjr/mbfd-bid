import type { JwtPayload } from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import { loadCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import {
  type BidAssignmentStatus,
  type BidAwardTransitionPlan,
  type EffectiveBidAssignment,
  isIsoCalendarDate,
  planBidAwardTransition,
} from '../../lib/bid-award-transition.js';
import { loadFrozenSessionBidPolicy } from '../../lib/bid-policy.js';
import { createCsvStream } from '../../lib/csv-stream.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

type BindingReviewStatus = 'approved' | 'draft' | 'retired';
type StaffingReviewStatus = 'approved' | 'draft' | 'retired';

interface BidSessionDbRow {
  id: string;
  current_phase: string;
  is_mock: number;
  completed_at: number | null;
}

interface BidDbRow {
  id: string;
  bid_session_id: string;
  position_id: string;
  member_id: number;
  ordinal: number;
}

interface PositionBindingDbRow {
  position_id: string;
  staffing_position_id: string;
  review_status: BindingReviewStatus | string;
  target_id: string | null;
  target_review_status: StaffingReviewStatus | string | null;
  target_active_from: string | null;
  target_active_to: string | null;
}

interface AssignmentDbRow {
  id: string;
  member_id: number;
  staffing_position_id: string;
  status: BidAssignmentStatus | string;
  effective_from: string;
  effective_to: string | null;
}

interface MemberDbRow {
  id: number;
  rank: string;
  employment_status: string;
}

interface LifecycleReceiptDbRow {
  id: string;
  member_id: number | null;
  staffing_position_id: string | null;
  member_assignment_id: string | null;
  idempotency_key: string;
  effective_on: string;
  reason: string;
  origin: string;
  actor_subject: string;
  kind: string;
  before_state: string;
  after_state: string;
  assignment_id: string | null;
  assignment_member_id: number | null;
  assignment_staffing_position_id: string | null;
  assignment_origin_type: string | null;
  assignment_origin_ref: string | null;
  assignment_status: string | null;
  assignment_effective_from: string | null;
  assignment_effective_to: string | null;
}

interface AuditReceiptDbRow {
  id: string;
  actor_id: number | null;
  reason: string | null;
  client_meta: string | null;
  target_id: string | null;
  before_state: string | null;
  after_state: string | null;
}

interface ReceiptAssignmentDbRow {
  id: string;
  member_id: number;
  staffing_position_id: string;
  status: string;
  effective_to: string | null;
}

interface TransitionReceipt {
  lifecycle: LifecycleReceiptDbRow[];
  audit: AuditReceiptDbRow[];
  awards: BidDbRow[];
  assignments: ReceiptAssignmentDbRow[];
}

interface RequestEvidence {
  sessionId: string;
  transition: string;
  effectiveOn: string;
  reason: string;
  actorSubject: string;
  actorId: number;
}

interface TransitionAuditStates {
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
}

interface ExactReceiptEvidence {
  auditBeforeState: string;
  auditAfterState: string;
  lifecycle: Array<{
    id: string;
    idempotencyKey: string;
    memberId: number;
    staffingPositionId: string;
    assignmentId: string;
    beforeState: string;
    afterState: string;
  }>;
}

interface TransitionContext {
  session: BidSessionDbRow;
  asOfDate: string;
  templateVersion: string;
  ruleBookVersion: string;
  plan: BidAwardTransitionPlan;
  awards: BidDbRow[];
  assignments: AssignmentDbRow[];
  membersById: ReadonlyMap<number, MemberDbRow>;
}

interface TransitionLoadFailure {
  ok: false;
  status: 404 | 409;
  body: { error: string; policy_error?: string };
}

interface TransitionMutation {
  assignmentId: string;
  eventId: string;
  eventIdempotencyKey: string;
  award: BidDbRow;
  planned: BidAwardTransitionPlan['plannedAssignments'][number];
  closure: BidAwardTransitionPlan['assignmentClosures'][number] | null;
  priorAssignment: AssignmentDbRow | null;
  member: MemberDbRow;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
}

const ApplyRequestSchema = z
  .object({
    effective_on: z.string(),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

const ReceiptLifecycleIdentitySchema = z
  .object({
    v: z.literal(1),
    origin: z.literal('BID'),
    bidSessionId: z.string().min(1),
    bidAwardId: z.string().min(1),
    bidPositionId: z.string().min(1),
    effectiveOn: z.string().refine(isIsoCalendarDate),
    member: z.object({ id: z.number().int().positive() }).passthrough(),
  })
  .passthrough();

const ReceiptLifecycleAfterStateSchema = ReceiptLifecycleIdentitySchema.extend({
  assignment: z
    .object({
      id: z.string().min(1),
      memberId: z.number().int().positive(),
      staffingPositionId: z.string().min(1),
      originType: z.literal('BID_AWARD'),
      originRef: z.string().min(1),
      status: z.literal('planned'),
      effectiveFrom: z.string().refine(isIsoCalendarDate),
      effectiveTo: z.null(),
    })
    .strict(),
});

const ReceiptPlannedAssignmentSchema = z
  .object({
    id: z.string().min(1),
    awardId: z.string().min(1),
    positionId: z.string().min(1),
    memberId: z.number().int().positive(),
    staffingPositionId: z.string().min(1),
    originType: z.literal('BID_AWARD'),
    originRef: z.string().min(1),
    status: z.literal('planned'),
    effectiveFrom: z.string().refine(isIsoCalendarDate),
    effectiveTo: z.null(),
    lifecycleEventId: z.string().min(1),
    lifecycleIdempotencyKey: z.string().min(1),
    beforeStateHash: z.string().regex(/^[a-f0-9]{64}$/),
    afterStateHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const ReceiptAssignmentClosureSchema = z
  .object({
    id: z.string().min(1),
    memberId: z.number().int().positive(),
    staffingPositionId: z.string().min(1),
    status: z.literal('active'),
    effectiveTo: z.string().refine(isIsoCalendarDate),
  })
  .strict();

const ReceiptAuditAfterStateSchema = z
  .object({
    v: z.literal(2),
    origin: z.literal('BID'),
    bidSessionId: z.string().min(1),
    effectiveOn: z.string().refine(isIsoCalendarDate),
    assignmentClosures: z.array(ReceiptAssignmentClosureSchema),
    plannedAssignments: z.array(ReceiptPlannedAssignmentSchema).min(1),
  })
  .strict();

const router = new Hono<AdminEnv>();
router.use('*', requireAdmin);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOpaqueId(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 256;
}

function hash(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

function transitionKey(sessionId: string, idempotencyKey: string): string {
  return `bid-award-transition:${hash(`${sessionId}\u0000${idempotencyKey}`)}`;
}

function eventKey(transition: string, awardId: string): string {
  return `${transition}:award:${hash(awardId).slice(0, 32)}`;
}

function auditClientMeta(transition: string): string {
  return JSON.stringify({ v: 2, transition_key: transition });
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
  return result.results[0] as T | undefined;
}

async function all<T>(db: D1Database, query: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all();
  return result.results as T[];
}

function mapApprovalStatus(
  value: BindingReviewStatus | string,
): 'approved' | 'pending' | 'rejected' {
  if (value === 'approved') return 'approved';
  if (value === 'retired') return 'rejected';
  return 'pending';
}

function targetStatus(
  row: PositionBindingDbRow,
  effectiveOn: string,
): 'active' | 'retired' | 'unknown' {
  if (row.target_id === null) return 'unknown';
  if (row.target_review_status !== 'approved') return 'retired';
  if (
    (row.target_active_from !== null && !isIsoCalendarDate(row.target_active_from)) ||
    (row.target_active_to !== null && !isIsoCalendarDate(row.target_active_to)) ||
    (row.target_active_from !== null &&
      row.target_active_to !== null &&
      row.target_active_to < row.target_active_from)
  ) {
    return 'unknown';
  }
  if (
    (row.target_active_from !== null && row.target_active_from > effectiveOn) ||
    (row.target_active_to !== null && row.target_active_to < effectiveOn)
  ) {
    return 'retired';
  }
  return 'active';
}

function lifecycleFailure(error: string): TransitionLoadFailure {
  return { ok: false, status: 409, body: { error } };
}

async function loadTransitionContext(
  db: D1Database,
  sessionId: string,
  effectiveOn: string,
): Promise<{ ok: true; context: TransitionContext } | ReturnType<typeof lifecycleFailure>> {
  const session = await first<BidSessionDbRow>(
    db,
    `SELECT id, current_phase, is_mock, completed_at
       FROM bid_sessions WHERE id = ?`,
    sessionId,
  );
  if (session === undefined) {
    return { ok: false, status: 404, body: { error: 'session_not_found' } };
  }
  if (
    (session.is_mock !== 0 && session.is_mock !== 1) ||
    (session.completed_at !== null &&
      (!Number.isSafeInteger(session.completed_at) || session.completed_at <= 0))
  ) {
    return lifecycleFailure('invalid_session');
  }

  // A canonical state row, if present, is authoritative. The legacy session
  // projection must independently agree that awards are complete; otherwise a
  // stale mirror could turn a paused or live Bid into staffing changes.
  try {
    const canonical = await loadCanonicalBidSessionState(db, sessionId);
    if (canonical !== null && canonical.currentPhase !== 'complete') {
      return lifecycleFailure('session_not_complete');
    }
  } catch {
    return lifecycleFailure('canonical_state_invalid');
  }

  const frozenPolicy = await loadFrozenSessionBidPolicy(getDb(db), sessionId);
  if (!frozenPolicy.ok || frozenPolicy.snapshot.v !== 3) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'session_policy_snapshot_unavailable',
        policy_error: !frozenPolicy.ok
          ? frozenPolicy.code
          : 'session_policy_snapshot_material_missing',
      },
    };
  }

  const [awards, bindings, assignments, members] = await Promise.all([
    all<BidDbRow>(
      db,
      `SELECT id, bid_session_id, position_id, member_id, ordinal
         FROM bids WHERE bid_session_id = ? ORDER BY ordinal ASC, id ASC`,
      sessionId,
    ),
    all<PositionBindingDbRow>(
      db,
      `SELECT binding.position_id, binding.staffing_position_id, binding.review_status,
              target.id AS target_id, target.review_status AS target_review_status,
              target.active_from AS target_active_from, target.active_to AS target_active_to
         FROM position_staffing_bindings binding
         LEFT JOIN staffing_positions target ON target.id = binding.staffing_position_id
        WHERE binding.template_version = ?`,
      frozenPolicy.snapshot.positionTemplateVersion,
    ),
    all<AssignmentDbRow>(
      db,
      `SELECT id, member_id, staffing_position_id, status, effective_from, effective_to
         FROM member_assignments`,
    ),
    all<MemberDbRow>(db, 'SELECT id, rank, employment_status FROM members'),
  ]);

  const asOfDate = todayUtc();
  const planned = planBidAwardTransition({
    session: {
      id: session.id,
      phase: session.current_phase,
      isMock: session.is_mock === 1,
      // A completed timestamp is the only final-award marker currently
      // persisted on the legacy session record. Without it, this route refuses
      // to infer that a merely completed-looking projection is immutable.
      awardsFrozen: session.completed_at !== null,
    },
    expectedPositionIds: frozenPolicy.coverage.validRulePositionIds,
    awards: awards.map((award) => ({
      id: award.id,
      bidSessionId: award.bid_session_id,
      positionId: award.position_id,
      memberId: award.member_id,
      ordinal: award.ordinal,
      status: 'awarded' as const,
    })),
    bindings: bindings.map((binding) => ({
      positionId: binding.position_id,
      staffingPositionId: binding.staffing_position_id,
      approvalStatus: mapApprovalStatus(binding.review_status),
      targetStatus: targetStatus(binding, effectiveOn),
    })),
    assignments: assignments.map<EffectiveBidAssignment>((assignment) => ({
      id: assignment.id,
      memberId: assignment.member_id,
      staffingPositionId: assignment.staffing_position_id,
      status: assignment.status as BidAssignmentStatus,
      effectiveFrom: assignment.effective_from,
      effectiveTo: assignment.effective_to,
    })),
    asOfDate,
    effectiveOn,
  });
  if (!planned.ok) return lifecycleFailure(planned.error);

  const membersById = new Map(members.map((member) => [member.id, member]));
  if (planned.plannedAssignments.some((assignment) => !membersById.has(assignment.memberId))) {
    return lifecycleFailure('invalid_frozen_award');
  }
  return {
    ok: true,
    context: {
      session,
      asOfDate,
      templateVersion: frozenPolicy.snapshot.positionTemplateVersion,
      ruleBookVersion: frozenPolicy.snapshot.ruleBookVersion,
      plan: planned,
      awards,
      assignments,
      membersById,
    },
  };
}

function assignmentEvidence(row: AssignmentDbRow | null): Record<string, unknown> | null {
  if (row === null) return null;
  return {
    id: row.id,
    memberId: row.member_id,
    staffingPositionId: row.staffing_position_id,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

function buildMutations(
  context: TransitionContext,
  transition: string,
): TransitionMutation[] | null {
  const awardById = new Map(context.awards.map((award) => [award.id, award]));
  const closureByMemberId = new Map(
    context.plan.assignmentClosures.map((closure) => [closure.memberId, closure]),
  );
  const assignmentById = new Map(
    context.assignments.map((assignment) => [assignment.id, assignment]),
  );
  const mutations: TransitionMutation[] = [];

  for (const planned of context.plan.plannedAssignments) {
    const award = awardById.get(planned.awardId);
    const member = context.membersById.get(planned.memberId);
    if (award === undefined || member === undefined) return null;
    const closure = closureByMemberId.get(planned.memberId) ?? null;
    const priorAssignment = closure === null ? null : (assignmentById.get(closure.id) ?? null);
    if (closure !== null && priorAssignment === null) return null;

    const assignmentId = ulid();
    const eventId = ulid();
    const eventIdempotencyKey = eventKey(transition, award.id);
    const beforeState = {
      v: 1,
      origin: 'BID',
      bidSessionId: context.session.id,
      bidAwardId: award.id,
      bidPositionId: award.position_id,
      effectiveOn: context.plan.effectiveOn,
      member: {
        id: member.id,
        rank: member.rank,
        employmentStatus: member.employment_status,
      },
      assignment: assignmentEvidence(priorAssignment),
    };
    const afterState = {
      v: 1,
      origin: 'BID',
      bidSessionId: context.session.id,
      bidAwardId: award.id,
      bidPositionId: award.position_id,
      effectiveOn: context.plan.effectiveOn,
      member: {
        id: member.id,
        rank: member.rank,
        employmentStatus: member.employment_status,
      },
      assignment: {
        id: assignmentId,
        memberId: planned.memberId,
        staffingPositionId: planned.staffingPositionId,
        originType: planned.originType,
        originRef: planned.originRef,
        status: planned.status,
        effectiveFrom: planned.effectiveFrom,
        effectiveTo: planned.effectiveTo,
      },
    };
    mutations.push({
      assignmentId,
      eventId,
      eventIdempotencyKey,
      award,
      planned,
      closure,
      priorAssignment,
      member,
      beforeState,
      afterState,
    });
  }
  return mutations;
}

function closureStatement(
  db: D1Database,
  sessionId: string,
  closure: NonNullable<TransitionMutation['closure']>,
  prior: AssignmentDbRow,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE member_assignments
          SET effective_to = ?, updated_at = ?
        WHERE id = ? AND member_id = ? AND staffing_position_id = ?
          AND status = 'active' AND effective_from = ? AND effective_to IS ?
          AND EXISTS (
            SELECT 1 FROM bid_sessions
             WHERE id = ? AND is_mock = 0 AND current_phase = 'complete'
               AND completed_at IS NOT NULL
          )`,
    )
    .bind(
      closure.effectiveTo,
      now,
      prior.id,
      prior.member_id,
      prior.staffing_position_id,
      prior.effective_from,
      prior.effective_to,
      sessionId,
    );
}

function plannedAssignmentStatement(
  db: D1Database,
  context: TransitionContext,
  mutation: TransitionMutation,
  now: number,
): D1PreparedStatement {
  const assignment = mutation.planned;
  return db
    .prepare(
      `INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status,
          effective_from, effective_to, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM bid_sessions
           WHERE id = ? AND is_mock = 0 AND current_phase = 'complete'
             AND completed_at IS NOT NULL
        )
          AND EXISTS (
            SELECT 1 FROM position_staffing_bindings binding
             WHERE binding.position_id = ? AND binding.template_version = ?
               AND binding.staffing_position_id = ? AND binding.review_status = 'approved'
          )
          AND EXISTS (
            SELECT 1 FROM staffing_positions target
             WHERE target.id = ? AND target.review_status = 'approved'
               AND (target.active_from IS NULL OR target.active_from <= ?)
               AND (target.active_to IS NULL OR target.active_to >= ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM member_assignments occupancy
             WHERE occupancy.status <> 'cancelled'
               AND (occupancy.member_id = ? OR occupancy.staffing_position_id = ?)
               AND occupancy.effective_from <= ?
               AND (occupancy.effective_to IS NULL OR occupancy.effective_to >= ?)
          )`,
    )
    .bind(
      mutation.assignmentId,
      assignment.memberId,
      assignment.staffingPositionId,
      assignment.originType,
      assignment.originRef,
      assignment.status,
      assignment.effectiveFrom,
      now,
      now,
      context.session.id,
      mutation.award.position_id,
      context.templateVersion,
      assignment.staffingPositionId,
      assignment.staffingPositionId,
      assignment.effectiveFrom,
      assignment.effectiveFrom,
      assignment.memberId,
      assignment.staffingPositionId,
      assignment.effectiveFrom,
      assignment.effectiveFrom,
    );
}

function lifecycleValues(mutation: TransitionMutation, now: number): unknown[] {
  return [
    mutation.eventId,
    mutation.member.id,
    mutation.planned.staffingPositionId,
    mutation.assignmentId,
    mutation.planned.effectiveFrom,
    mutation.member.employment_status,
    mutation.member.employment_status,
    mutation.member.rank,
    mutation.member.rank,
    null,
    // The reason is substituted by the caller so the method remains useful for
    // the final guarded insert as well as ordinary per-award inserts.
    null,
    'BID',
    null,
    mutation.eventIdempotencyKey,
    JSON.stringify(mutation.beforeState),
    JSON.stringify(mutation.afterState),
    null,
    now,
  ];
}

function lifecycleStatement(
  db: D1Database,
  mutation: TransitionMutation,
  reason: string,
  actorSubject: string,
  now: number,
): D1PreparedStatement {
  const values = lifecycleValues(mutation, now);
  values[10] = reason;
  values[12] = actorSubject;
  return db
    .prepare(
      `INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       VALUES (?, ?, ?, ?, 'ADMIN_REASSIGNMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...values);
}

function transitionGuard(
  context: TransitionContext,
  mutations: readonly TransitionMutation[],
): { sql: string; bindings: unknown[] } {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    clauses.push(sql);
    bindings.push(...values);
  };

  add(
    `EXISTS (
       SELECT 1 FROM bid_sessions
        WHERE id = ? AND is_mock = 0 AND current_phase = 'complete'
          AND completed_at IS NOT NULL
     )`,
    context.session.id,
  );
  // If a canonical command projection exists, a non-complete JSON state must
  // block the transaction. A malformed JSON document causes SQLite/D1 to
  // abort this guarded statement rather than allowing a silent transition.
  add(
    `NOT EXISTS (
       SELECT 1 FROM canonical_bid_session_state
        WHERE bid_session_id = ?
          AND json_extract(state_json, '$.currentPhase') <> 'complete'
     )`,
    context.session.id,
  );
  add(
    `EXISTS (
       SELECT 1 FROM bid_session_policy_snapshots
        WHERE bid_session_id = ? AND rule_book_version = ?
          AND position_template_version = ?
     )`,
    context.session.id,
    context.ruleBookVersion,
    context.templateVersion,
  );
  add(
    '(SELECT count(*) FROM bids WHERE bid_session_id = ?) = ?',
    context.session.id,
    context.awards.length,
  );
  for (const award of context.awards) {
    add(
      `EXISTS (
         SELECT 1 FROM bids
          WHERE id = ? AND bid_session_id = ? AND ordinal = ?
            AND member_id = ? AND position_id = ?
       )`,
      award.id,
      context.session.id,
      award.ordinal,
      award.member_id,
      award.position_id,
    );
  }
  for (const mutation of mutations) {
    if (mutation.closure !== null && mutation.priorAssignment !== null) {
      add(
        `EXISTS (
           SELECT 1 FROM member_assignments
            WHERE id = ? AND member_id = ? AND staffing_position_id = ?
              AND status = 'active' AND effective_from = ? AND effective_to = ?
         )`,
        mutation.priorAssignment.id,
        mutation.priorAssignment.member_id,
        mutation.priorAssignment.staffing_position_id,
        mutation.priorAssignment.effective_from,
        mutation.closure.effectiveTo,
      );
    }
    add(
      `EXISTS (
         SELECT 1 FROM member_assignments
          WHERE id = ? AND member_id = ? AND staffing_position_id = ?
            AND origin_type = 'BID_AWARD' AND origin_ref = ? AND status = 'planned'
            AND effective_from = ? AND effective_to IS NULL
       )`,
      mutation.assignmentId,
      mutation.planned.memberId,
      mutation.planned.staffingPositionId,
      mutation.planned.originRef,
      mutation.planned.effectiveFrom,
    );
  }
  for (const mutation of mutations.slice(0, -1)) {
    add(
      `EXISTS (
         SELECT 1 FROM personnel_lifecycle_events
          WHERE id = ? AND idempotency_key = ? AND kind = 'ADMIN_REASSIGNMENT'
            AND origin = 'BID' AND effective_on = ?
       )`,
      mutation.eventId,
      mutation.eventIdempotencyKey,
      mutation.planned.effectiveFrom,
    );
  }
  return { sql: clauses.map((clause) => `(${clause})`).join(' AND '), bindings };
}

function guardedLifecycleStatement(
  db: D1Database,
  mutation: TransitionMutation,
  reason: string,
  actorSubject: string,
  now: number,
  guard: { sql: string; bindings: unknown[] },
): D1PreparedStatement {
  const values = lifecycleValues(mutation, now);
  values[10] = reason;
  values[12] = actorSubject;
  const [id, memberId, staffingPositionId, assignmentId, ...afterKind] = values;
  // The final lifecycle entry doubles as an atomic D1 guard. A failed
  // postcondition deliberately violates the table's kind CHECK, aborting the
  // native D1 batch before it can commit a partial closure/assignment set.
  return db
    .prepare(
      `INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       SELECT ?, ?, ?, ?,
              CASE WHEN ${guard.sql}
                   THEN 'ADMIN_REASSIGNMENT'
                   ELSE 'INVALID_TRANSITION_GUARD'
              END,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`,
    )
    .bind(id, memberId, staffingPositionId, assignmentId, ...guard.bindings, ...afterKind);
}

function buildTransitionAuditStates(
  context: TransitionContext,
  mutations: readonly TransitionMutation[],
): TransitionAuditStates {
  const beforeState = {
    v: 1,
    origin: 'BID',
    bidSessionId: context.session.id,
    asOfDate: context.asOfDate,
    effectiveOn: context.plan.effectiveOn,
    ruleBookVersion: context.ruleBookVersion,
    positionTemplateVersion: context.templateVersion,
    currentToNew: context.plan.currentToNew,
  };
  const afterState = {
    // Version 2 binds every event to its created assignment and state hashes,
    // so a retried request never treats a merely non-empty receipt as proof
    // that all final awards committed.
    v: 2,
    origin: 'BID',
    bidSessionId: context.session.id,
    effectiveOn: context.plan.effectiveOn,
    assignmentClosures: context.plan.assignmentClosures,
    plannedAssignments: mutations.map((mutation) => ({
      id: mutation.assignmentId,
      awardId: mutation.planned.awardId,
      positionId: mutation.award.position_id,
      memberId: mutation.planned.memberId,
      staffingPositionId: mutation.planned.staffingPositionId,
      originType: mutation.planned.originType,
      originRef: mutation.planned.originRef,
      status: mutation.planned.status,
      effectiveFrom: mutation.planned.effectiveFrom,
      effectiveTo: mutation.planned.effectiveTo,
      lifecycleEventId: mutation.eventId,
      lifecycleIdempotencyKey: mutation.eventIdempotencyKey,
      beforeStateHash: hash(JSON.stringify(mutation.beforeState)),
      afterStateHash: hash(JSON.stringify(mutation.afterState)),
    })),
  };
  return { beforeState, afterState };
}

function exactReceiptEvidence(
  states: TransitionAuditStates,
  mutations: readonly TransitionMutation[],
): ExactReceiptEvidence {
  return {
    auditBeforeState: JSON.stringify(states.beforeState),
    auditAfterState: JSON.stringify(states.afterState),
    lifecycle: mutations.map((mutation) => ({
      id: mutation.eventId,
      idempotencyKey: mutation.eventIdempotencyKey,
      memberId: mutation.member.id,
      staffingPositionId: mutation.planned.staffingPositionId,
      assignmentId: mutation.assignmentId,
      beforeState: JSON.stringify(mutation.beforeState),
      afterState: JSON.stringify(mutation.afterState),
    })),
  };
}

function auditStatement(
  db: D1Database,
  context: TransitionContext,
  transition: string,
  actorId: number,
  reason: string,
  states: TransitionAuditStates,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at)
       SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'bid_award_transition',
              'bid_session', ?, ?, ?, ?, NULL, ?, ?
         FROM audit_log WHERE bid_session_id = ?`,
    )
    .bind(
      ulid(),
      context.session.id,
      actorId,
      context.session.id,
      JSON.stringify(states.beforeState),
      JSON.stringify(states.afterState),
      reason,
      auditClientMeta(transition),
      Math.floor(now / 1_000),
      context.session.id,
    );
}

async function receipt(
  db: D1Database,
  sessionId: string,
  transition: string,
): Promise<TransitionReceipt> {
  const [lifecycle, audit, awards, assignments] = await Promise.all([
    all<LifecycleReceiptDbRow>(
      db,
      `SELECT event.id, event.member_id, event.staffing_position_id, event.member_assignment_id,
              event.idempotency_key, event.effective_on, event.reason, event.origin,
              event.actor_subject, event.kind, event.before_state, event.after_state,
              assignment.id AS assignment_id, assignment.member_id AS assignment_member_id,
              assignment.staffing_position_id AS assignment_staffing_position_id,
              assignment.origin_type AS assignment_origin_type,
              assignment.origin_ref AS assignment_origin_ref,
              assignment.status AS assignment_status,
              assignment.effective_from AS assignment_effective_from,
              assignment.effective_to AS assignment_effective_to
         FROM personnel_lifecycle_events event
         LEFT JOIN member_assignments assignment ON assignment.id = event.member_assignment_id
        WHERE event.idempotency_key LIKE ? ORDER BY event.id`,
      `${transition}:%`,
    ),
    all<AuditReceiptDbRow>(
      db,
      `SELECT id, actor_id, reason, client_meta, target_id, before_state, after_state
         FROM audit_log
        WHERE bid_session_id = ? AND action = 'bid_award_transition' AND client_meta = ?
        ORDER BY id`,
      sessionId,
      auditClientMeta(transition),
    ),
    all<BidDbRow>(
      db,
      `SELECT id, bid_session_id, position_id, member_id, ordinal
         FROM bids WHERE bid_session_id = ? ORDER BY ordinal ASC, id ASC`,
      sessionId,
    ),
    all<ReceiptAssignmentDbRow>(
      db,
      `SELECT id, member_id, staffing_position_id, status, effective_to
         FROM member_assignments`,
    ),
  ]);
  return { lifecycle, audit, awards, assignments };
}

function parseReceiptAuditAfterState(value: string | null) {
  if (value === null) return null;
  try {
    const parsed = ReceiptAuditAfterStateSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseReceiptLifecycleIdentity(value: string) {
  try {
    const parsed = ReceiptLifecycleIdentitySchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseReceiptLifecycleAfterState(value: string) {
  try {
    const parsed = ReceiptLifecycleAfterStateSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function matchesExactReceipt(value: TransitionReceipt, expected: ExactReceiptEvidence): boolean {
  const audit = value.audit[0];
  if (
    audit === undefined ||
    audit.before_state !== expected.auditBeforeState ||
    audit.after_state !== expected.auditAfterState ||
    value.lifecycle.length !== expected.lifecycle.length
  ) {
    return false;
  }
  const byId = new Map(value.lifecycle.map((entry) => [entry.id, entry]));
  if (byId.size !== expected.lifecycle.length) return false;
  return expected.lifecycle.every((expectedEntry) => {
    const actual = byId.get(expectedEntry.id);
    return (
      actual !== undefined &&
      actual.idempotency_key === expectedEntry.idempotencyKey &&
      actual.member_id === expectedEntry.memberId &&
      actual.staffing_position_id === expectedEntry.staffingPositionId &&
      actual.member_assignment_id === expectedEntry.assignmentId &&
      actual.before_state === expectedEntry.beforeState &&
      actual.after_state === expectedEntry.afterState
    );
  });
}

function matchingReceipt(
  value: TransitionReceipt,
  expected: RequestEvidence,
  exact?: ExactReceiptEvidence,
): 'none' | 'replay' | 'conflict' | 'incomplete' {
  if (value.lifecycle.length === 0 && value.audit.length === 0) return 'none';
  if (value.lifecycle.length === 0 || value.audit.length !== 1) return 'incomplete';
  const audit = value.audit[0];
  if (
    audit === undefined ||
    audit.actor_id !== expected.actorId ||
    audit.reason !== expected.reason
  ) {
    return 'conflict';
  }
  if (
    audit.target_id !== expected.sessionId ||
    audit.client_meta !== auditClientMeta(expected.transition)
  ) {
    return 'incomplete';
  }
  const auditState = parseReceiptAuditAfterState(audit.after_state);
  if (
    auditState === null ||
    auditState.bidSessionId !== expected.sessionId ||
    auditState.effectiveOn !== expected.effectiveOn ||
    value.awards.length === 0 ||
    value.lifecycle.length !== auditState.plannedAssignments.length ||
    auditState.plannedAssignments.length !== value.awards.length ||
    hasDuplicate(auditState.plannedAssignments.map((entry) => entry.id)) ||
    hasDuplicate(auditState.plannedAssignments.map((entry) => entry.awardId)) ||
    hasDuplicate(auditState.plannedAssignments.map((entry) => entry.lifecycleEventId)) ||
    hasDuplicate(auditState.plannedAssignments.map((entry) => entry.lifecycleIdempotencyKey)) ||
    hasDuplicate(auditState.assignmentClosures.map((entry) => entry.id))
  ) {
    return 'incomplete';
  }
  const awardsById = new Map(value.awards.map((award) => [award.id, award]));
  if (awardsById.size !== value.awards.length) return 'incomplete';
  const lifecycleById = new Map(value.lifecycle.map((entry) => [entry.id, entry]));
  const assignmentsById = new Map(
    value.assignments.map((assignment) => [assignment.id, assignment]),
  );
  for (const planned of auditState.plannedAssignments) {
    const award = awardsById.get(planned.awardId);
    const event = lifecycleById.get(planned.lifecycleEventId);
    if (
      award === undefined ||
      event === undefined ||
      award.bid_session_id !== expected.sessionId ||
      award.position_id !== planned.positionId ||
      award.member_id !== planned.memberId ||
      planned.originRef !== `bid-award:${expected.sessionId}:${award.id}` ||
      planned.effectiveFrom !== expected.effectiveOn ||
      planned.lifecycleIdempotencyKey !== eventKey(expected.transition, award.id) ||
      event.idempotency_key !== planned.lifecycleIdempotencyKey ||
      event.member_id !== planned.memberId ||
      event.staffing_position_id !== planned.staffingPositionId ||
      event.member_assignment_id !== planned.id ||
      event.effective_on !== expected.effectiveOn ||
      event.reason !== expected.reason ||
      event.origin !== 'BID' ||
      event.actor_subject !== expected.actorSubject ||
      event.kind !== 'ADMIN_REASSIGNMENT' ||
      hash(event.before_state) !== planned.beforeStateHash ||
      hash(event.after_state) !== planned.afterStateHash ||
      event.assignment_id !== planned.id ||
      event.assignment_member_id !== planned.memberId ||
      event.assignment_staffing_position_id !== planned.staffingPositionId ||
      event.assignment_origin_type !== planned.originType ||
      event.assignment_origin_ref !== planned.originRef ||
      event.assignment_status !== planned.status ||
      event.assignment_effective_from !== planned.effectiveFrom ||
      event.assignment_effective_to !== planned.effectiveTo
    ) {
      return 'incomplete';
    }
    const beforeState = parseReceiptLifecycleIdentity(event.before_state);
    const afterState = parseReceiptLifecycleAfterState(event.after_state);
    if (
      beforeState === null ||
      afterState === null ||
      beforeState.bidSessionId !== expected.sessionId ||
      beforeState.bidAwardId !== award.id ||
      beforeState.bidPositionId !== award.position_id ||
      beforeState.effectiveOn !== expected.effectiveOn ||
      beforeState.member.id !== planned.memberId ||
      afterState.bidSessionId !== expected.sessionId ||
      afterState.bidAwardId !== award.id ||
      afterState.bidPositionId !== award.position_id ||
      afterState.effectiveOn !== expected.effectiveOn ||
      afterState.member.id !== planned.memberId ||
      afterState.assignment.id !== planned.id ||
      afterState.assignment.memberId !== planned.memberId ||
      afterState.assignment.staffingPositionId !== planned.staffingPositionId ||
      afterState.assignment.originRef !== planned.originRef ||
      afterState.assignment.effectiveFrom !== planned.effectiveFrom
    ) {
      return 'incomplete';
    }
  }
  for (const closure of auditState.assignmentClosures) {
    const assignment = assignmentsById.get(closure.id);
    if (
      assignment === undefined ||
      !auditState.plannedAssignments.some((planned) => planned.memberId === closure.memberId) ||
      assignment.member_id !== closure.memberId ||
      assignment.staffing_position_id !== closure.staffingPositionId ||
      assignment.status !== closure.status ||
      assignment.effective_to !== closure.effectiveTo
    ) {
      return 'incomplete';
    }
  }
  if (exact !== undefined && !matchesExactReceipt(value, exact)) return 'incomplete';
  return 'replay';
}

router.get('/:sessionId/preview', async (c) => {
  const sessionId = c.req.param('sessionId');
  if (!isOpaqueId(sessionId)) return c.json({ error: 'invalid_session_id' }, 400);
  const effectiveOn = c.req.query('effective_on');
  if (effectiveOn === undefined || !isIsoCalendarDate(effectiveOn)) {
    return c.json({ error: 'invalid_effective_on' }, 400);
  }

  const loaded = await loadTransitionContext(c.env.DB, sessionId, effectiveOn);
  if (!loaded.ok) return c.json(loaded.body, loaded.status);
  return c.json({ transition: loaded.context.plan });
});

/**
 * Download the exact fail-closed, current-to-new plan used by the preview
 * screen. This direct CSV is review-only and never applies an assignment.
 */
router.get('/:sessionId/transition.csv', async (c) => {
  const sessionId = c.req.param('sessionId');
  if (!isOpaqueId(sessionId)) return c.json({ error: 'invalid_session_id' }, 400);
  const effectiveOn = c.req.query('effective_on');
  if (effectiveOn === undefined || !isIsoCalendarDate(effectiveOn)) {
    return c.json({ error: 'invalid_effective_on' }, 400);
  }

  const loaded = await loadTransitionContext(c.env.DB, sessionId, effectiveOn);
  if (!loaded.ok) return c.json(loaded.body, loaded.status);
  const { plan } = loaded.context;
  async function* rows() {
    for (const row of plan.currentToNew) yield row;
  }

  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
  return new Response(
    createCsvStream(rows(), [
      { header: 'bid_session_id', value: () => plan.bidSessionId },
      { header: 'as_of_date', value: () => plan.asOfDate },
      { header: 'effective_on', value: () => plan.effectiveOn },
      { header: 'ordinal', value: (row) => row.ordinal },
      { header: 'award_id', value: (row) => row.awardId },
      { header: 'member_id', value: (row) => row.memberId },
      { header: 'bid_position_id', value: (row) => row.positionId },
      { header: 'current_assignment_id', value: (row) => row.currentAssignment?.id },
      {
        header: 'current_staffing_position_id',
        value: (row) => row.currentAssignment?.staffingPositionId,
      },
      { header: 'current_assignment_status', value: (row) => row.currentAssignment?.status },
      {
        header: 'current_assignment_effective_from',
        value: (row) => row.currentAssignment?.effectiveFrom,
      },
      {
        header: 'current_assignment_effective_to',
        value: (row) => row.currentAssignment?.effectiveTo,
      },
      { header: 'new_staffing_position_id', value: (row) => row.newAssignment.staffingPositionId },
      { header: 'new_assignment_status', value: (row) => row.newAssignment.status },
      {
        header: 'new_assignment_effective_from',
        value: (row) => row.newAssignment.effectiveFrom,
      },
      { header: 'new_assignment_origin_ref', value: (row) => row.newAssignment.originRef },
    ]),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mbfd-bid-transition-${safeSessionId}.csv"`,
        'Cache-Control': 'no-store',
      },
    },
  );
});

router.post('/:sessionId/apply', requireStepUpAuth(), async (c) => {
  const sessionId = c.req.param('sessionId');
  if (!isOpaqueId(sessionId)) return c.json({ error: 'invalid_session_id' }, 400);
  const raw = await c.req.json().catch(() => null);
  const parsed = ApplyRequestSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  if (!isIsoCalendarDate(parsed.data.effective_on)) {
    return c.json({ error: 'invalid_effective_on' }, 400);
  }
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'idempotency_key_required' }, 400);
  }
  if (idempotencyKey !== idempotencyKey.trim() || idempotencyKey.length > 256) {
    return c.json({ error: 'invalid_idempotency_key' }, 400);
  }
  const claims = c.get('claims');
  // Production JWT validation requires a positive member_id. The nonnegative
  // branch remains only for the isolated legacy fixture decoder used by tests.
  if (!Number.isSafeInteger(claims.member_id) || claims.member_id < 0) {
    return c.json({ error: 'operator_identity_required' }, 403);
  }
  const actorId = claims.member_id;
  const actorSubject = String(actorId);
  const transition = transitionKey(sessionId, idempotencyKey);
  const requestEvidence = {
    sessionId,
    transition,
    effectiveOn: parsed.data.effective_on,
    reason: parsed.data.reason,
    actorSubject,
    actorId,
  };

  const priorReceipt = await receipt(c.env.DB, sessionId, transition);
  const priorDisposition = matchingReceipt(priorReceipt, requestEvidence);
  if (priorDisposition === 'replay') {
    return c.json({
      replayed: true,
      effectiveOn: parsed.data.effective_on,
      lifecycleEventIds: priorReceipt.lifecycle.map((entry) => entry.id),
      portalWriteback: 'not_enqueued',
    });
  }
  if (priorDisposition === 'conflict') return c.json({ error: 'idempotency_key_reused' }, 409);
  if (priorDisposition === 'incomplete')
    return c.json({ error: 'transition_receipt_incomplete' }, 409);

  const loaded = await loadTransitionContext(c.env.DB, sessionId, parsed.data.effective_on);
  if (!loaded.ok) return c.json(loaded.body, loaded.status);
  const mutations = buildMutations(loaded.context, transition);
  if (mutations === null || mutations.length === 0) {
    return c.json({ error: 'bid_award_transition_not_applicable' }, 409);
  }
  const auditStates = buildTransitionAuditStates(loaded.context, mutations);
  const expectedReceipt = exactReceiptEvidence(auditStates, mutations);

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const mutation of mutations) {
    if (mutation.closure !== null && mutation.priorAssignment !== null) {
      statements.push(
        closureStatement(
          c.env.DB,
          loaded.context.session.id,
          mutation.closure,
          mutation.priorAssignment,
          now,
        ),
      );
    }
  }
  for (const mutation of mutations) {
    statements.push(plannedAssignmentStatement(c.env.DB, loaded.context, mutation, now));
  }
  for (const mutation of mutations.slice(0, -1)) {
    statements.push(lifecycleStatement(c.env.DB, mutation, parsed.data.reason, actorSubject, now));
  }
  const finalMutation = mutations[mutations.length - 1];
  if (finalMutation === undefined)
    return c.json({ error: 'bid_award_transition_not_applicable' }, 409);
  statements.push(
    guardedLifecycleStatement(
      c.env.DB,
      finalMutation,
      parsed.data.reason,
      actorSubject,
      now,
      transitionGuard(loaded.context, mutations),
    ),
  );
  statements.push(
    auditStatement(
      c.env.DB,
      loaded.context,
      transition,
      actorId,
      parsed.data.reason,
      auditStates,
      now,
    ),
  );

  try {
    await c.env.DB.batch(statements);
  } catch {
    const retried = await receipt(c.env.DB, sessionId, transition);
    // A batch error can mean a concurrent request with the same idempotency
    // key won the race. Its ULIDs differ from this attempt, so accept it only
    // if the persisted v2 evidence independently proves the complete plan.
    const exactDisposition = matchingReceipt(retried, requestEvidence, expectedReceipt);
    const disposition =
      exactDisposition === 'incomplete'
        ? matchingReceipt(retried, requestEvidence)
        : exactDisposition;
    if (disposition === 'replay') {
      return c.json({
        replayed: true,
        effectiveOn: parsed.data.effective_on,
        lifecycleEventIds: retried.lifecycle.map((entry) => entry.id),
        portalWriteback: 'not_enqueued',
      });
    }
    if (disposition === 'conflict') return c.json({ error: 'idempotency_key_reused' }, 409);
    if (disposition === 'incomplete')
      return c.json({ error: 'transition_receipt_incomplete' }, 409);
    return c.json({ error: 'bid_award_transition_not_applied' }, 409);
  }

  const committed = await receipt(c.env.DB, sessionId, transition);
  if (matchingReceipt(committed, requestEvidence, expectedReceipt) !== 'replay') {
    return c.json({ error: 'transition_receipt_incomplete' }, 409);
  }
  return c.json(
    {
      replayed: false,
      effectiveOn: parsed.data.effective_on,
      createdAssignments: mutations.length,
      lifecycleEventIds: committed.lifecycle.map((entry) => entry.id),
      portalWriteback: 'not_enqueued',
    },
    201,
  );
});

export default router;
