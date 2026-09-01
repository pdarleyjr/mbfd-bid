import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import {
  BidForMemberSchema,
  ForcePickSchema,
  type JwtPayload,
  LockPositionSchema,
  SkipSchema,
} from '@mbfd/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { hasCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidSessions, bids } from '../../db/schema.js';
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
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

function frozenPolicyFailureStatus(code: string): 409 | 422 {
  return code.startsWith('session_') ? 409 : 422;
}

function isBidCommandPhase(phase: string): boolean {
  return phase === 'position_bid' || phase === 'a_day_bid';
}

const router = new Hono<Env>();
router.use('*', requireAdmin);

// POST /api/admin/bid-session/:id/force-pick
router.post(
  '/:id/force-pick',
  requireStepUpAuth(),
  zValidator('json', ForcePickSchema),
  async (c) => {
    const sessionId = c.req.param('id');
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
    const adminActorId = claims.sub > 0 ? claims.sub : null;
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
router.post('/:id/skip', requireStepUpAuth(), zValidator('json', SkipSchema), async (c) => {
  const sessionId = c.req.param('id');
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
    const current = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (current.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    await writeAuditLog(db, {
      bidSessionId: sessionId,
      actorType: 'admin',
      actorId: claims.sub > 0 ? claims.sub : 0,
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
});

// POST /api/admin/bid-session/:id/bid-for-member
router.post(
  '/:id/bid-for-member',
  requireStepUpAuth(),
  zValidator('json', BidForMemberSchema),
  async (c) => {
    const sessionId = c.req.param('id');
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
    const adminActorId = claims.sub > 0 ? claims.sub : null;
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
          actorId: claims.sub > 0 ? claims.sub : 0,
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
