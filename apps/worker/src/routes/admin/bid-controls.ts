import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import {
  AmendSelectionSchema,
  BidForMemberSchema,
  ForcePickSchema,
  type JwtPayload,
  LiveBidCommandSchema,
  LockPositionSchema,
  SkipSchema,
  isLiveBidActionAuthorized,
} from '@mbfd/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import {
  hasCanonicalBidSessionState,
  loadCanonicalBidSessionState,
} from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidAwardAmendments, bidSessions, bids } from '../../db/schema.js';
import type { BidSessionState } from '../../durable/bid-session-state.js';
import {
  higherPriorityFrozenSpecialtyCandidates,
  rankFrozenSpecialtyCandidates,
} from '../../lib/annual-specialty-policy.js';
import { auditInsertStatement, writeAuditLog } from '../../lib/audit.js';
import {
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadFrozenSessionBidPolicy,
  resolveFrozenSessionBidTarget,
} from '../../lib/bid-policy.js';
import { isReasonValidForAction } from '../../lib/reason-codes.js';
import { runWithNormalBidMutationLease } from '../../lib/specialty-interruption-guard.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin, requireLiveBidAction } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

function frozenPolicyFailureStatus(code: string): 409 | 422 {
  return code.startsWith('session_') ? 409 : 422;
}

function isBidCommandPhase(phase: string): boolean {
  return phase === 'position_bid' || phase === 'a_day_bid';
}

async function loadLiveAdapterState(
  env: WorkerEnv,
  sessionId: string,
): Promise<BidSessionState | null> {
  const canonical = await loadCanonicalBidSessionState(env.DB, sessionId);
  if (canonical !== null) return canonical;
  const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(sessionId));
  const response = await stub.fetch('https://bid.internal/admin/state/live');
  return response.ok ? ((await response.json()) as BidSessionState) : null;
}

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.get('/:id/specialty-live', async (c) => {
  const sessionId = c.req.param('id');
  const [canonical, frozen] = await Promise.all([
    loadLiveAdapterState(c.env, sessionId),
    loadFrozenSessionBidPolicy(getDb(c.env.DB), sessionId),
  ]);
  if (canonical === null) return c.json({ error: 'live_state_missing' }, 409);
  if (!frozen.ok || frozen.snapshot.settings.v !== 3)
    return c.json({ error: 'live_action_policy_missing' }, 409);
  const policy = frozen.snapshot.settings.livePolicy;
  const identities = new Map(
    (frozen.snapshot.operatorIdentityProjection ?? []).map((identity) => [
      identity.memberId,
      identity,
    ]),
  );
  const member = (memberId: number) => {
    const identity = identities.get(memberId);
    return {
      member_id: memberId,
      first_name: identity?.firstName ?? '',
      last_name: identity?.lastName ?? '',
      rank: identity?.rank ?? null,
    };
  };
  const active = canonical.live?.specialty ?? null;
  let activeProjection: Record<string, unknown> | null = null;
  if (active !== null) {
    const specialty = policy.annualOperations?.specialties?.find(
      (candidate) => candidate.id === active.specialtyId,
    );
    if (specialty === undefined || frozen.snapshot.credentialEvaluationOn === undefined)
      return c.json({ error: 'live_specialty_policy_missing' }, 409);
    const ranked = rankFrozenSpecialtyCandidates({
      policy: specialty,
      evaluationOn: frozen.snapshot.credentialEvaluationOn,
      members: frozen.snapshot.members.map((candidate) => ({
        memberId: candidate.memberId,
        rscSeniority: candidate.rscSeniority,
        rankSeniority: candidate.rankSeniority,
        credentialNames: candidate.credentialNames,
        specialtyQualifications: candidate.specialtyQualifications,
      })),
    });
    const byMember = new Map(
      ranked.map((candidate, index) => [
        candidate.memberId,
        { points: candidate.points, policy_rank: index + 1 },
      ]),
    );
    const currentCandidateId = active.candidateMemberIds[active.candidateCursor] ?? null;
    const attempts = canonical.annual?.contactAttempts ?? [];
    activeProjection = {
      specialty_id: active.specialtyId,
      specialty_label: specialty.label,
      requested_position_id: active.positionId,
      original_bidder: {
        ...member(active.suspendedBidderId),
        ...byMember.get(active.suspendedBidderId),
      },
      candidates: active.candidateMemberIds.map((memberId) => ({
        ...member(memberId),
        ...byMember.get(memberId),
        status:
          memberId === currentCandidateId
            ? 'CURRENT'
            : active.candidateMemberIds.indexOf(memberId) < active.candidateCursor
              ? 'RESOLVED'
              : 'REMAINING',
        contact_history: attempts
          .filter((attempt) => attempt.memberId === memberId)
          .map((attempt) => ({
            method: attempt.method,
            at_ms: attempt.atMs,
            actor_member_id: attempt.actorMemberId,
          })),
      })),
      current_candidate_id: currentCandidateId,
      remaining_candidate_ids: active.candidateMemberIds.slice(active.candidateCursor),
      suspended_turn: true,
      resume: {
        member_id: active.suspendedBidderId,
        queue_cursor: canonical.queueCursor,
        current_phase: canonical.currentPhase,
      },
    };
  }
  return c.json({
    bid_session_id: sessionId,
    sequence: canonical.lastSeq,
    current_bidder: canonical.currentBidderId === null ? null : member(canonical.currentBidderId),
    remaining_order: canonical.bidOrder.slice(canonical.queueCursor).map((entry) => entry.memberId),
    fills: Object.fromEntries(
      Object.entries(canonical.fills).map(([positionId, fill]) => [
        positionId,
        { member_id: fill.memberId },
      ]),
    ),
    specialties: (policy.annualOperations?.specialties ?? []).map((specialty) => ({
      id: specialty.id,
      label: specialty.label,
      mode: specialty.mode,
      positions: specialty.opportunityPositionIds.map((positionId) => {
        const position = frozen.snapshot.ruleBookMaterial.positions.find(
          (item) => item.id === positionId,
        );
        return {
          id: positionId,
          label:
            position === undefined
              ? positionId
              : `${position.station} ${position.unit} ${position.positionName}`,
        };
      }),
    })),
    active: activeProjection,
  });
});

// The adapter deliberately assigns actor/session identity.  It is the one
// public entry point for real mutations; older force/skip routes remain
// compatibility paths and cannot create canonical live state.
router.post('/:id/commands/live', requireStepUpAuth(), async (c) => {
  const sessionId = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return c.json({ error: 'invalid_live_bid_command' }, 400);
  const claims = c.get('claims');
  const db = getDb(c.env.DB);
  const frozen = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozen.ok || frozen.snapshot.settings.v !== 3)
    return c.json({ error: 'live_action_policy_missing' }, 409);
  let normalizedRaw: Record<string, unknown> = raw;
  if (raw.type === 'live.start_specialty_adjudication') {
    const specialtyId = typeof raw.specialtyId === 'string' ? raw.specialtyId : null;
    const specialty = frozen.snapshot.settings.livePolicy.annualOperations?.specialties?.find(
      (entry) => entry.id === specialtyId,
    );
    if (specialty === undefined) return c.json({ error: 'live_specialty_policy_missing' }, 409);
    if (frozen.snapshot.credentialEvaluationOn === undefined)
      return c.json({ error: 'live_specialty_evidence_date_missing' }, 409);
    const canonical = await loadLiveAdapterState(c.env, sessionId);
    if (canonical === null || canonical.currentBidderId === null)
      return c.json({ error: 'live_specialty_requester_missing' }, 409);
    const target = await resolveFrozenSessionBidTarget(db, {
      bidSessionId: sessionId,
      memberId: canonical.currentBidderId,
      positionId: typeof raw.positionId === 'string' ? raw.positionId : '',
    });
    if (!target.ok) return c.json({ error: target.code }, frozenPolicyFailureStatus(target.code));
    const requester = frozenEligibilityMemberForSession(frozen.snapshot, canonical.currentBidderId);
    if (requester === null) return c.json({ error: 'live_specialty_requester_missing' }, 409);
    if (!evaluateEligibility(eligibilityMemberFromFrozen(requester), target.rule).eligible)
      return c.json({ error: 'live_specialty_requester_position_ineligible' }, 409);
    try {
      const positionEligibleMemberIds = new Set(
        frozen.snapshot.members
          .filter((member) => {
            const eligibilityMember = frozenEligibilityMemberForSession(
              frozen.snapshot,
              member.memberId,
            );
            return (
              member.pool !== 'EXCLUDED' &&
              eligibilityMember !== null &&
              evaluateEligibility(eligibilityMemberFromFrozen(eligibilityMember), target.rule)
                .eligible
            );
          })
          .map((member) => member.memberId),
      );
      const candidates = higherPriorityFrozenSpecialtyCandidates({
        policy: specialty,
        evaluationOn: frozen.snapshot.credentialEvaluationOn,
        members: frozen.snapshot.members
          .filter((member) => member.pool !== 'EXCLUDED')
          .map((member) => ({
            memberId: member.memberId,
            rscSeniority: member.rscSeniority,
            rankSeniority: member.rankSeniority,
            credentialNames: member.credentialNames,
            specialtyQualifications: member.specialtyQualifications,
          })),
        requesterMemberId: canonical.currentBidderId,
        positionEligibleMemberIds,
      });
      if (candidates.length === 0)
        return c.json({ error: 'live_specialty_no_higher_priority_candidate' }, 409);
      normalizedRaw = {
        ...raw,
        candidateMemberIds: candidates.map((candidate) => candidate.memberId),
      };
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'live_specialty_policy_invalid' },
        409,
      );
    }
  }
  const command = LiveBidCommandSchema.safeParse({
    ...normalizedRaw,
    bidSessionId: sessionId,
    actor: { id: claims.member_id, role: 'admin' },
  });
  if (!command.success) return c.json({ error: 'invalid_live_bid_command' }, 400);
  const action =
    command.data.type === 'live.record_selection'
      ? 'record_selection'
      : command.data.type === 'live.amend_selection'
        ? 'amend_selection'
        : command.data.type === 'live.force_selection'
          ? 'force'
          : command.data.type === 'live.disposition'
            ? command.data.disposition === 'UNREACHABLE'
              ? 'mark_unreachable'
              : 'skip_defer'
            : command.data.type === 'live.transition_stage'
              ? 'approve_transition'
              : command.data.type === 'live.alter_order'
                ? 'alter_order'
                : command.data.type === 'live.complete_session'
                  ? 'approve_final_results'
                  : command.data.type === 'live.record_contact_attempt' ||
                      command.data.type === 'live.declare_unreachable'
                    ? 'mark_unreachable'
                    : command.data.type === 'live.return_at_current_sequence'
                      ? 'skip_defer'
                      : command.data.type === 'live.set_presentation_mode'
                        ? 'publish'
                        : command.data.type === 'live.start_specialty_adjudication' ||
                            command.data.type === 'live.resolve_specialty_candidate'
                          ? 'approve_transition'
                          : 'pause_resume';
  if (!isLiveBidActionAuthorized(frozen.snapshot.settings.livePolicy, action, claims.member_id))
    return c.json({ error: 'live_action_forbidden', action }, 403);
  const stub = c.env.BID_SESSION.get(c.env.BID_SESSION.idFromName(sessionId));
  const response = await stub.fetch('https://bid.internal/admin/commands/live', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command.data),
  });
  return c.json(await response.json(), response.status as 200 | 400 | 409);
});

// POST /api/admin/bid-session/:id/force-pick
router.post(
  '/:id/force-pick',
  requireStepUpAuth(),
  requireLiveBidAction('force'),
  zValidator('json', ForcePickSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const forceSession = await getDb(c.env.DB)
      .select({ isMock: bidSessions.isMock })
      .from(bidSessions)
      .where(eq(bidSessions.id, sessionId))
      .get();
    if (forceSession !== undefined && !forceSession.isMock)
      return c.json(
        { error: 'canonical_live_command_required', command: 'live.force_selection' },
        409,
      );
    const body = c.req.valid('json');

    if (!isReasonValidForAction('forced_pick', body.reason_code)) {
      return c.json(
        {
          error: 'invalid_reason_for_action',
          action: 'forced_pick',
          reason_code: body.reason_code,
        },
        400,
      );
    }

    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (session.isMock) {
      return c.json({ error: 'mock_rehearsal_control_required' }, 409);
    }
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    // A force-pick is an override of turn order, never an override of the
    // frozen policy boundary. In particular, neither an excluded Division
    // Chief nor an administratively assigned non-biddable position can be
    // injected through this direct administrative route.
    const target = await resolveFrozenSessionBidTarget(db, {
      bidSessionId: sessionId,
      memberId: body.member_id,
      positionId: body.position_id,
    });
    if (!target.ok) {
      return c.json({ error: target.code }, frozenPolicyFailureStatus(target.code));
    }
    // A direct administrative pick cannot create a real Bid before the normal
    // session-start gate has admitted it. `position_bid` and `a_day_bid` are
    // the only active command phases; a config/paused/completed session must
    // never gain a pending award through this legacy control path.
    if (!isBidCommandPhase(session.currentPhase)) {
      return c.json({ error: 'bid_session_not_active', current_phase: session.currentPhase }, 409);
    }

    // Idempotency: header overrides; otherwise generate a stable key.
    const idemKey =
      c.req.header('Idempotency-Key')?.trim() ||
      `force:${sessionId}:${body.member_id}:${body.position_id}`;

    const existing = await db.select().from(bids).where(eq(bids.idempotencyKey, idemKey)).get();
    if (existing !== undefined) {
      return c.json({ bid_id: existing.id, forced: true, idempotent_replay: true });
    }

    const bidId = ulid();
    const claims = c.get('claims');
    // A bridge-only administrator may not have a canonical Bid member row.
    // Persist NULL rather than the synthetic id 0 so a strict FK cannot turn
    // an otherwise authorized, active-session action into a 500.
    const adminActorId = claims.member_id;
    const now = new Date();

    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (current.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
      if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      if (!isBidCommandPhase(current.currentPhase)) {
        return c.json(
          { error: 'bid_session_not_active', current_phase: current.currentPhase },
          409,
        );
      }
      // A different request can have acquired and released the permit after
      // the fast-path read above. Recheck while holding this permit so a
      // duplicate request is a replay rather than a D1 unique-key failure.
      const existingAfterLease = await db
        .select()
        .from(bids)
        .where(eq(bids.idempotencyKey, idemKey))
        .get();
      if (existingAfterLease !== undefined) {
        return c.json({ bid_id: existingAfterLease.id, forced: true, idempotent_replay: true });
      }

      // Read and advance the legacy ordinal only after holding the session
      // permit, so two direct D1 writers cannot both derive the same value.
      const maxOrdRow = await db
        .select({ m: sql<number | null>`max(${bids.ordinal})` })
        .from(bids)
        .where(eq(bids.bidSessionId, sessionId))
        .get();
      const ordinal = (maxOrdRow?.m ?? 0) + 1;
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO bids
               (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
                admin_actor_id, reason, idempotency_key, portal_sync_status, portal_sync_attempts)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'pending', 0)`,
        ).bind(
          bidId,
          sessionId,
          ordinal,
          body.member_id,
          body.position_id,
          now.getTime(),
          adminActorId,
          body.reason,
          idemKey,
        ),
        auditInsertStatement(
          c.env.DB,
          {
            bidSessionId: sessionId,
            actorType: 'admin',
            actorId: adminActorId,
            action: 'forced_pick',
            targetKind: 'bid',
            targetId: bidId,
            reason: body.reason,
            afterState: {
              member_id: body.member_id,
              position_id: body.position_id,
              reason_code: body.reason_code,
            },
          },
          now,
        ),
      ]);
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return c.json({ error: 'forced_pick_not_applied' }, 409);
      }

      return c.json({ bid_id: bidId, forced: true }, 201);
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

// POST /api/admin/bid-session/:id/skip
router.post(
  '/:id/skip',
  requireStepUpAuth(),
  requireLiveBidAction('skip_defer'),
  zValidator('json', SkipSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const skipSession = await getDb(c.env.DB)
      .select({ isMock: bidSessions.isMock })
      .from(bidSessions)
      .where(eq(bidSessions.id, sessionId))
      .get();
    if (skipSession !== undefined && !skipSession.isMock)
      return c.json({ error: 'canonical_live_command_required', command: 'live.disposition' }, 409);
    const body = c.req.valid('json');

    if (!isReasonValidForAction('skip', body.reason_code)) {
      return c.json(
        { error: 'invalid_reason_for_action', action: 'skip', reason_code: body.reason_code },
        400,
      );
    }

    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (session.isMock) {
      return c.json({ error: 'mock_rehearsal_control_required' }, 409);
    }
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }

    const frozenPolicy = await loadFrozenSessionBidPolicy(db, sessionId);
    if (!frozenPolicy.ok) {
      return c.json({ error: frozenPolicy.code }, frozenPolicyFailureStatus(frozenPolicy.code));
    }
    const frozenMember = frozenPolicy.snapshot.members.find(
      (entry) => entry.memberId === body.member_id,
    );
    if (frozenMember === undefined) {
      return c.json({ error: 'member_not_in_bid_pool' }, 422);
    }
    if (frozenMember.pool === 'EXCLUDED') {
      return c.json({ error: 'member_excluded_from_bid_pool' }, 422);
    }

    const claims = c.get('claims');
    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (current.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
      if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      await writeAuditLog(db, {
        bidSessionId: sessionId,
        actorType: 'admin',
        actorId: claims.member_id,
        action: 'skip',
        targetKind: 'member',
        targetId: String(body.member_id),
        reason: body.reason,
        afterState: { skipped_member_id: body.member_id, reason_code: body.reason_code },
      });

      return c.json({ skipped_member_id: body.member_id, reason_code: body.reason_code });
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

// POST /api/admin/bid-session/:id/bid-for-member
router.post(
  '/:id/bid-for-member',
  requireStepUpAuth(),
  requireLiveBidAction('record_selection'),
  zValidator('json', BidForMemberSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const proxySession = await getDb(c.env.DB)
      .select({ isMock: bidSessions.isMock })
      .from(bidSessions)
      .where(eq(bidSessions.id, sessionId))
      .get();
    if (proxySession !== undefined && !proxySession.isMock)
      return c.json(
        { error: 'canonical_live_command_required', command: 'live.record_selection' },
        409,
      );
    const body = c.req.valid('json');

    if (!isReasonValidForAction('admin_bid_for_member', body.reason_code)) {
      return c.json(
        {
          error: 'invalid_reason_for_action',
          action: 'admin_bid_for_member',
          reason_code: body.reason_code,
        },
        400,
      );
    }

    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (session.isMock) {
      return c.json({ error: 'mock_rehearsal_control_required' }, 409);
    }
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    const target = await resolveFrozenSessionBidTarget(db, {
      bidSessionId: sessionId,
      memberId: body.member_id,
      positionId: body.position_id,
    });
    if (!target.ok) {
      return c.json({ error: target.code }, frozenPolicyFailureStatus(target.code));
    }
    if (!isBidCommandPhase(session.currentPhase)) {
      return c.json({ error: 'bid_session_not_active', current_phase: session.currentPhase }, 409);
    }

    const frozenMember = frozenEligibilityMemberForSession(target.snapshot, body.member_id);
    if (frozenMember === null) {
      return c.json({ error: 'session_policy_snapshot_material_missing' }, 409);
    }
    const evalResult = evaluateEligibility(eligibilityMemberFromFrozen(frozenMember), target.rule);
    if (!evalResult.eligible) {
      return c.json({ error: 'ineligible', reasons: evalResult.reasons }, 422);
    }

    const idemKey =
      c.req.header('Idempotency-Key')?.trim() ||
      `proxy:${sessionId}:${body.member_id}:${body.position_id}`;
    const existing = await db.select().from(bids).where(eq(bids.idempotencyKey, idemKey)).get();
    if (existing !== undefined) {
      return c.json({ bid_id: existing.id, forced: false, idempotent_replay: true });
    }

    const claims = c.get('claims');
    // See force-pick: bridge-only admin identities are auditable by type but
    // cannot be represented as a nonexistent member id 0.
    const adminActorId = claims.member_id;
    const bidId = ulid();

    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (current.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
      if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      if (!isBidCommandPhase(current.currentPhase)) {
        return c.json(
          { error: 'bid_session_not_active', current_phase: current.currentPhase },
          409,
        );
      }
      // Recheck after the permit is acquired. A concurrent same-key request
      // may have committed between the optimistic fast-path lookup and this
      // serialized D1 write.
      const existingAfterLease = await db
        .select()
        .from(bids)
        .where(eq(bids.idempotencyKey, idemKey))
        .get();
      if (existingAfterLease !== undefined) {
        return c.json({ bid_id: existingAfterLease.id, forced: false, idempotent_replay: true });
      }

      const now = new Date();
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO bids
               (id, bid_session_id, ordinal, member_id, position_id, a_day, picked_at, forced,
                admin_actor_id, reason, idempotency_key, portal_sync_status, portal_sync_attempts)
             VALUES (?, ?, 0, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', 0)`,
        ).bind(
          bidId,
          sessionId,
          body.member_id,
          body.position_id,
          body.a_day ?? null,
          now.getTime(),
          adminActorId,
          body.reason,
          idemKey,
        ),
        auditInsertStatement(
          c.env.DB,
          {
            bidSessionId: sessionId,
            actorType: 'admin',
            actorId: adminActorId,
            action: 'admin_bid_for_member',
            targetKind: 'bid',
            targetId: bidId,
            reason: body.reason,
            afterState: {
              member_id: body.member_id,
              position_id: body.position_id,
              a_day: body.a_day ?? null,
              reason_code: body.reason_code,
            },
          },
          now,
        ),
      ]);
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return c.json({ error: 'admin_bid_not_applied' }, 409);
      }

      return c.json({ bid_id: bidId, forced: false }, 201);
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

// POST /api/admin/bid-session/:id/amend-selection
// The immediately latest award may be replaced while its turn is still the
// most recent committed selection. The old row is retained and linked; this is
// deliberately not a destructive undo endpoint.
router.post(
  '/:id/amend-selection',
  requireStepUpAuth(),
  requireLiveBidAction('amend_selection'),
  zValidator('json', AmendSelectionSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    if (sessionId !== '')
      return c.json(
        { error: 'canonical_live_command_required', command: 'live.amend_selection' },
        409,
      );
    const body = c.req.valid('json');
    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (session.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    if (!isBidCommandPhase(session.currentPhase)) {
      return c.json({ error: 'bid_session_not_active', current_phase: session.currentPhase }, 409);
    }
    const original = await db.select().from(bids).where(eq(bids.id, body.bid_id)).get();
    if (original === undefined || original.bidSessionId !== sessionId) {
      return c.json({ error: 'award_not_found' }, 404);
    }
    const target = await resolveFrozenSessionBidTarget(db, {
      bidSessionId: sessionId,
      memberId: original.memberId,
      positionId: body.position_id,
    });
    if (!target.ok) return c.json({ error: target.code }, frozenPolicyFailureStatus(target.code));

    const replacementBidId = ulid();
    const idempotencyKey =
      c.req.header('Idempotency-Key')?.trim() || `amend:${body.bid_id}:${body.position_id}`;
    const actorMemberId = c.get('claims').member_id;
    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (current.mockControlRevision !== body.expected_session_revision) {
        return c.json(
          { error: 'stale_session_revision', current_revision: current.mockControlRevision },
          409,
        );
      }
      const existing = await db
        .select()
        .from(bids)
        .where(eq(bids.idempotencyKey, idempotencyKey))
        .get();
      if (existing !== undefined) return c.json({ bid_id: existing.id, idempotent_replay: true });
      const replaced = await db
        .select({ id: bidAwardAmendments.id })
        .from(bidAwardAmendments)
        .where(eq(bidAwardAmendments.originalBidId, original.id))
        .get();
      if (replaced !== undefined) return c.json({ error: 'award_already_superseded' }, 409);
      const laterCommitted = await c.env.DB.prepare(
        'SELECT id FROM bids WHERE bid_session_id = ? AND picked_at > ? LIMIT 1',
      )
        .bind(sessionId, original.pickedAt.getTime())
        .first<{ id: string }>();
      if (laterCommitted !== null) return c.json({ error: 'award_sealed_by_next_selection' }, 409);
      const positionTaken = await c.env.DB.prepare(
        `SELECT b.id FROM bids b
         WHERE b.bid_session_id = ? AND b.position_id = ?
           AND b.id <> ?
           AND NOT EXISTS (SELECT 1 FROM bid_award_amendments a WHERE a.original_bid_id = b.id)
         LIMIT 1`,
      )
        .bind(sessionId, body.position_id, original.id)
        .first<{ id: string }>();
      if (positionTaken !== null) return c.json({ error: 'position_filled' }, 409);
      const now = new Date();
      const amendmentId = ulid();
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE bid_sessions SET mock_control_revision = mock_control_revision + 1
           WHERE id = ? AND mock_control_revision = ?`,
        ).bind(sessionId, body.expected_session_revision),
        c.env.DB.prepare(`UPDATE bids SET portal_sync_status = 'superseded' WHERE id = ?`).bind(
          original.id,
        ),
        c.env.DB.prepare(
          `INSERT INTO bids
             (id, bid_session_id, ordinal, member_id, position_id, a_day, picked_at, forced,
              admin_actor_id, reason, idempotency_key, portal_sync_status, portal_sync_attempts)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', 0)`,
        ).bind(
          replacementBidId,
          sessionId,
          original.ordinal,
          original.memberId,
          body.position_id,
          original.aDay,
          now.getTime(),
          actorMemberId,
          body.reason,
          idempotencyKey,
        ),
        c.env.DB.prepare(
          `INSERT INTO bid_award_amendments
             (id, bid_session_id, original_bid_id, replacement_bid_id, actor_member_id,
              expected_session_revision, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          amendmentId,
          sessionId,
          original.id,
          replacementBidId,
          actorMemberId,
          body.expected_session_revision,
          body.reason,
          now.getTime(),
        ),
        auditInsertStatement(
          c.env.DB,
          {
            bidSessionId: sessionId,
            actorType: 'admin',
            actorId: actorMemberId,
            action: 'amend_selection',
            targetKind: 'bid',
            targetId: replacementBidId,
            reason: body.reason,
            beforeState: { bid_id: original.id, position_id: original.positionId },
            afterState: {
              bid_id: replacementBidId,
              supersedes_bid_id: original.id,
              position_id: body.position_id,
            },
          },
          now,
        ),
      ]);
      if (results.some((result) => result.meta.changes !== 1)) {
        return c.json({ error: 'amendment_not_applied' }, 409);
      }
      return c.json(
        {
          bid_id: replacementBidId,
          supersedes_bid_id: original.id,
          revision: body.expected_session_revision + 1,
        },
        201,
      );
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

// POST /api/admin/bid-session/:id/lock-position
router.post(
  '/:id/lock-position',
  requireStepUpAuth(),
  zValidator('json', LockPositionSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const body = c.req.valid('json');

    if (!isReasonValidForAction('lock_position', body.reason_code)) {
      return c.json(
        {
          error: 'invalid_reason_for_action',
          action: 'lock_position',
          reason_code: body.reason_code,
        },
        400,
      );
    }

    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (session.isMock) {
      return c.json({ error: 'mock_rehearsal_control_required' }, 409);
    }
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    if (session.currentPhase !== 'config') {
      return c.json(
        { error: 'locks_only_in_config_phase', current_phase: session.currentPhase },
        409,
      );
    }

    const target = await resolveFrozenSessionBidTarget(db, {
      bidSessionId: sessionId,
      memberId: body.member_id,
      positionId: body.position_id,
    });
    if (!target.ok) {
      return c.json({ error: target.code }, frozenPolicyFailureStatus(target.code));
    }

    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (current.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
      if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      if (current.currentPhase !== 'config') {
        return c.json(
          { error: 'locks_only_in_config_phase', current_phase: current.currentPhase },
          409,
        );
      }
      const cfg: { position_locks?: { position_id: string; member_id: number }[] } =
        current.configJson !== null && current.configJson !== ''
          ? JSON.parse(current.configJson)
          : {};
      cfg.position_locks = Array.isArray(cfg.position_locks) ? cfg.position_locks : [];
      const conflict = cfg.position_locks.find((l) => l.position_id === body.position_id);
      if (conflict !== undefined) {
        return c.json({ error: 'position_already_locked', existing: conflict }, 409);
      }
      cfg.position_locks.push({ position_id: body.position_id, member_id: body.member_id });

      const claims = c.get('claims');
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE bid_sessions SET config_json = ? WHERE id = ? AND current_phase = ?',
        ).bind(JSON.stringify(cfg), sessionId, 'config'),
        auditInsertStatement(c.env.DB, {
          bidSessionId: sessionId,
          actorType: 'admin',
          actorId: claims.member_id,
          action: 'lock_position',
          targetKind: 'position',
          targetId: body.position_id,
          reason: body.reason,
          afterState: { member_id: body.member_id, reason_code: body.reason_code },
        }),
      ]);
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return c.json({ error: 'position_lock_not_applied' }, 409);
      }

      return c.json({
        position_id: body.position_id,
        member_id: body.member_id,
        reason_code: body.reason_code,
      });
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

export default router;
