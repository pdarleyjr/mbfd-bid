import { zValidator } from '@hono/zod-validator';
import {
  DayEndSchema,
  DayStartSchema,
  type JwtPayload,
  PauseSessionSchema,
  ResumeSessionSchema,
  TimerConfigSchema,
  evaluateLiveReadiness,
} from '@mbfd/shared';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  hasCanonicalBidSessionState,
  loadCanonicalBidSessionState,
} from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidOrder, bidSessions, bidYears } from '../../db/schema.js';
import type { BidSessionState } from '../../durable/bid-session-state.js';
import { writeAuditLog } from '../../lib/audit.js';
import { computeBidOrder } from '../../lib/bid-order.js';
import {
  bidOrderInputFromSnapshot,
  loadBidSessionPolicySnapshot,
  loadFrozenSessionBidPolicy,
  prepareBidSessionPolicySnapshot,
  summarizeBidSessionPolicySnapshot,
} from '../../lib/bid-policy.js';
import { runWithNormalBidMutationLease } from '../../lib/specialty-interruption-guard.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const CreateSessionSchema = z.object({
  bid_year: z.number().int().min(2024).max(2100),
  // These legacy request fields are accepted only to return a typed mismatch.
  // Session settings themselves always come from the designated annual config.
  expected_duration_days: z.number().int().min(1).max(7).optional(),
  turn_timer_seconds: z.number().int().min(30).max(600).optional(),
  is_mock: z.boolean().optional().default(false),
});

function actorIdFromClaims(claims: JwtPayload): number | null {
  return claims.sub > 0 ? claims.sub : null;
}

function orderMatchesFrozenSnapshot(
  persisted: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
  expected: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
): boolean {
  return (
    persisted.length === expected.length &&
    persisted.every((entry, index) => {
      const candidate = expected[index];
      return (
        candidate !== undefined &&
        entry.ordinal === candidate.ordinal &&
        entry.memberId === candidate.memberId &&
        entry.pool === candidate.pool
      );
    })
  );
}

/**
 * The command route must fail closed until the Worker can supply each of the
 * required, independently verified readiness facts. Do not infer readiness
 * from partial D1 data or an administrator's request to start.
 */
function evaluateUnconfiguredLiveReadiness() {
  return evaluateLiveReadiness({ checks: [] });
}

async function hasCanonicalCommandState(env: WorkerEnv, bidSessionId: string): Promise<boolean> {
  return hasCanonicalBidSessionState(env.DB, bidSessionId);
}

const router = new Hono<Env>();
router.use('*', requireAdmin);

// GET /api/admin/bid-session/active
router.get('/active', async (c) => {
  const db = getDb(c.env.DB);
  const sessions = await db.select().from(bidSessions).orderBy(desc(bidSessions.startedAt)).all();
  for (const legacySession of sessions) {
    let canonical: BidSessionState | null;
    try {
      canonical = await loadCanonicalBidSessionState(c.env.DB, legacySession.id);
    } catch {
      return c.json({ error: 'canonical_state_unavailable' }, 503);
    }
    const session =
      canonical === null
        ? legacySession
        : {
            ...legacySession,
            currentPhase: canonical.currentPhase,
            currentBidderId: canonical.currentBidderId,
            currentTurnStartedAt:
              canonical.turnStartedAtMs > 0 ? new Date(canonical.turnStartedAtMs) : null,
            turnTimerSeconds: canonical.turnTimerSeconds,
            pausedAt:
              canonical.currentPhase === 'paused' && canonical.frozenAt !== null
                ? new Date(canonical.frozenAt)
                : legacySession.pausedAt,
            frozenAt: canonical.frozenAt === null ? null : new Date(canonical.frozenAt),
          };
    if (session.currentPhase !== 'complete') return c.json({ session });
  }

  return c.json({ session: null });
});

// POST /api/admin/bid-session
router.post('/', requireStepUpAuth(), zValidator('json', CreateSessionSchema), async (c) => {
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const year = await db.select().from(bidYears).where(eq(bidYears.year, body.bid_year)).get();
  if (year === undefined) {
    return c.json({ error: 'bid_year_not_found', bid_year: body.bid_year }, 400);
  }
  const id = ulid();
  const now = new Date();
  const policy = await prepareBidSessionPolicySnapshot(
    db,
    body.bid_year,
    now.getTime(),
    body.is_mock ? 'mock' : 'live',
  );
  if (!policy.ok) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: policy.code,
        position_ids: policy.positionIds ?? [],
      },
      409,
    );
  }
  if (
    (body.expected_duration_days !== undefined &&
      body.expected_duration_days !== policy.snapshot.settings.expectedDurationDays) ||
    (body.turn_timer_seconds !== undefined &&
      body.turn_timer_seconds !== policy.snapshot.settings.turnTimerSeconds)
  ) {
    return c.json(
      {
        error: 'session_configuration_settings_mismatch',
        settings: {
          expected_duration_days: policy.snapshot.settings.expectedDurationDays,
          turn_timer_seconds: policy.snapshot.settings.turnTimerSeconds,
        },
      },
      409,
    );
  }
  const settings = policy.snapshot.settings;
  const configurationRevision = policy.snapshot.configurationRevision;

  // D1 batch is the session-creation boundary: a newly visible session must
  // always carry the frozen policy input used to build its ordinary Bid pool.
  // No mutable-staffing fallback is allowed after this point.
  const creation = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO bid_sessions (
          id, bid_year, started_at, current_phase, turn_timer_seconds,
          expected_duration_days, day_count, is_mock
        )
        SELECT ?, ?, ?, 'config', ?, ?, 0, ?
        WHERE EXISTS (
          SELECT 1
          FROM rule_books
          WHERE version = ?
            AND revision = ?
            AND status = ?
        )
        AND EXISTS (
          SELECT 1
          FROM bid_years
          WHERE year = ?
            AND rule_book_version = ?
            AND position_template_version = ?
            AND configuration_revision = ?
        )`,
    ).bind(
      id,
      body.bid_year,
      now.getTime(),
      settings.turnTimerSeconds,
      settings.expectedDurationDays,
      body.is_mock ? 1 : 0,
      policy.snapshot.ruleBookVersion,
      policy.snapshot.ruleBookRevision,
      body.is_mock ? 'draft' : 'active',
      body.bid_year,
      policy.snapshot.ruleBookVersion,
      policy.snapshot.positionTemplateVersion,
      configurationRevision,
    ),
    c.env.DB.prepare(
      `INSERT INTO bid_session_policy_snapshots (
          bid_session_id, rule_book_version, position_template_version,
          rule_book_revision, snapshot_json, captured_at
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM bid_sessions WHERE id = ?)`,
    ).bind(
      id,
      policy.snapshot.ruleBookVersion,
      policy.snapshot.positionTemplateVersion,
      policy.snapshot.ruleBookRevision,
      JSON.stringify(policy.snapshot),
      now.getTime(),
      id,
    ),
  ]);
  if (creation[0]?.meta.changes !== 1 || creation[1]?.meta.changes !== 1) {
    return c.json({ error: 'bid_configuration_changed' }, 409);
  }
  await writeAuditLog(db, {
    bidSessionId: id,
    actorType: 'admin',
    actorId: actorIdFromClaims(c.get('claims')),
    action: 'session_start',
    targetKind: 'bid_session',
    targetId: id,
    afterState: {
      bid_year: body.bid_year,
      current_phase: 'config',
      is_mock: body.is_mock,
      rule_book_version: policy.snapshot.ruleBookVersion,
      rule_book_revision: policy.snapshot.ruleBookRevision,
      position_template_version: policy.snapshot.positionTemplateVersion,
      configuration_revision: policy.snapshot.configurationRevision,
      settings,
      pool: summarizeBidSessionPolicySnapshot(policy.snapshot),
    },
  });
  return c.json(
    {
      id,
      current_phase: 'config',
      is_mock: body.is_mock,
      rule_book_version: policy.snapshot.ruleBookVersion,
      rule_book_revision: policy.snapshot.ruleBookRevision,
      position_template_version: policy.snapshot.positionTemplateVersion,
      configuration_revision: policy.snapshot.configurationRevision,
      settings: {
        expected_duration_days: settings.expectedDurationDays,
        turn_timer_seconds: settings.turnTimerSeconds,
      },
      pool: summarizeBidSessionPolicySnapshot(policy.snapshot),
    },
    201,
  );
});

// GET /api/admin/bid-session/:id/policy-snapshot
// Admin read-only view used to verify the frozen Officer/FF pool before a
// session is initialized. It intentionally returns normalized identifiers only.
router.get('/:id/policy-snapshot', async (c) => {
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const session = await db
    .select({ id: bidSessions.id })
    .from(bidSessions)
    .where(eq(bidSessions.id, id))
    .get();
  if (session === undefined) return c.json({ error: 'not_found' }, 404);
  const loaded = await loadBidSessionPolicySnapshot(db, id);
  if (loaded.snapshot === null) {
    return c.json({ error: 'session_policy_snapshot_invalid', detail: loaded.error }, 409);
  }
  const frozenPolicy = await loadFrozenSessionBidPolicy(db, id);
  if (!frozenPolicy.ok) {
    // Older records have a syntactically valid pointer-only snapshot but no
    // immutable material. Preserve an explicitly non-operational forensic view
    // rather than silently resolving it through today's draft. Any malformed
    // V3 material remains a hard failure and is never represented as valid.
    if (
      frozenPolicy.code === 'session_policy_snapshot_material_missing' &&
      loaded.snapshot.v !== 3
    ) {
      return c.json({
        snapshot: loaded.snapshot,
        summary: summarizeBidSessionPolicySnapshot(loaded.snapshot),
        operationally_valid: false,
        policy_error: frozenPolicy.code,
      });
    }
    return c.json(
      { error: 'session_policy_snapshot_unavailable', policy_error: frozenPolicy.code },
      409,
    );
  }
  return c.json({
    snapshot: frozenPolicy.snapshot,
    summary: summarizeBidSessionPolicySnapshot(frozenPolicy.snapshot),
    operationally_valid: true,
  });
});

// POST /api/admin/bid-session/:id/start
router.post('/:id/start', requireStepUpAuth(), async (c) => {
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
  if (s === undefined) return c.json({ error: 'not_found' }, 404);
  if (await hasCanonicalCommandState(c.env, id)) {
    return c.json({ error: 'canonical_mutation_requires_command' }, 409);
  }
  if (s.currentPhase !== 'config') {
    return c.json({ error: 'invalid_state', current_phase: s.currentPhase }, 409);
  }
  const frozenPolicy = await loadFrozenSessionBidPolicy(db, id);
  if (!frozenPolicy.ok) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: frozenPolicy.code,
      },
      409,
    );
  }
  const expectedOrder = computeBidOrder(bidOrderInputFromSnapshot(frozenPolicy.snapshot));
  if (expectedOrder.length === 0) {
    return c.json({ error: 'session_policy_bid_order_empty' }, 409);
  }
  const existingOrder = await db
    .select({ ordinal: bidOrder.ordinal, memberId: bidOrder.memberId, pool: bidOrder.pool })
    .from(bidOrder)
    .where(eq(bidOrder.bidSessionId, id))
    .orderBy(asc(bidOrder.ordinal))
    .all();
  if (existingOrder.length > 0 && !orderMatchesFrozenSnapshot(existingOrder, expectedOrder)) {
    return c.json({ error: 'bid_order_not_frozen_policy' }, 409);
  }
  if (!s.isMock) {
    const readiness = evaluateUnconfiguredLiveReadiness();
    if (!readiness.canStartLiveBid) {
      return c.json({ error: 'readiness_blocked', readiness }, 409);
    }
  }
  const now = new Date();
  const statements: D1PreparedStatement[] = [];
  if (existingOrder.length === 0) {
    // D1 has a conservative bound-parameter cap. Keep each insert safely
    // below it while retaining the whole session-start transition in one D1
    // batch. A session is not visible as position_bid until its frozen order
    // has been written.
    const orderInsertChunkSize = 20;
    for (let index = 0; index < expectedOrder.length; index += orderInsertChunkSize) {
      const chunk = expectedOrder.slice(index, index + orderInsertChunkSize);
      const values = chunk.map(() => '(?, ?, ?, ?)').join(', ');
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES ${values}`,
        ).bind(...chunk.flatMap((entry) => [id, entry.ordinal, entry.memberId, entry.pool])),
      );
    }
  }
  statements.push(
    c.env.DB.prepare(
      `UPDATE bid_sessions
            SET current_phase = 'position_bid',
                current_bidder_id = ?,
                current_turn_started_at = ?,
                started_at = ?,
                mock_control_revision = mock_control_revision + 1
          WHERE id = ? AND current_phase = 'config'`,
    ).bind(expectedOrder[0]?.memberId ?? null, now.getTime(), now.getTime(), id),
  );
  const mutation = await runWithNormalBidMutationLease(c.env, id, async () => {
    // The canonical command service can win the lease between the optimistic
    // preflight above and this callback. Never allow a legacy D1 transition to
    // follow a canonical state transition once that service owns the session.
    if (await hasCanonicalCommandState(c.env, id)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    const current = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
    if (current === undefined) return c.json({ error: 'not_found' }, 404);
    if (current.currentPhase !== 'config') {
      return c.json({ error: 'invalid_state', current_phase: current.currentPhase }, 409);
    }
    const results = await c.env.DB.batch(statements);
    if (results[results.length - 1]?.meta.changes !== 1) {
      return c.json({ error: 'session_state_changed' }, 409);
    }
    await writeAuditLog(db, {
      bidSessionId: id,
      actorType: 'admin',
      actorId: actorIdFromClaims(c.get('claims')),
      action: 'session_start',
      targetKind: 'bid_session',
      targetId: id,
      beforeState: { current_phase: 'config', bid_order_count: existingOrder.length },
      afterState: {
        current_phase: 'position_bid',
        bid_order_count: expectedOrder.length,
        rule_book_version: frozenPolicy.snapshot.ruleBookVersion,
        position_template_version: frozenPolicy.snapshot.positionTemplateVersion,
      },
    });
    return c.json({ id, current_phase: 'position_bid', bid_order_count: expectedOrder.length });
  });
  if (!mutation.ok) return c.json({ error: mutation.error }, 409);
  return mutation.value;
});

// GET /api/admin/bid-session/:id/readiness
// The output is intentionally data-only. It is not an override mechanism.
router.get('/:id/readiness', async (c) => {
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
  if (session === undefined) return c.json({ error: 'not_found' }, 404);

  return c.json({
    id,
    is_mock: session.isMock,
    readiness: session.isMock ? null : evaluateUnconfiguredLiveReadiness(),
  });
});

// POST /api/admin/bid-session/:id/pause
router.post(
  '/:id/pause',
  requireStepUpAuth(),
  zValidator('json', PauseSessionSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = getDb(c.env.DB);
    const s = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
    if (s === undefined) return c.json({ error: 'not_found' }, 404);
    if (await hasCanonicalCommandState(c.env, id)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    if (s.currentPhase === 'paused' || s.currentPhase === 'complete') {
      return c.json({ error: 'invalid_state', current_phase: s.currentPhase }, 409);
    }
    const mutation = await runWithNormalBidMutationLease(c.env, id, async () => {
      if (await hasCanonicalCommandState(c.env, id)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      const current = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
      if (current === undefined) return c.json({ error: 'not_found' }, 404);
      if (current.currentPhase === 'paused' || current.currentPhase === 'complete') {
        return c.json({ error: 'invalid_state', current_phase: current.currentPhase }, 409);
      }
      const now = new Date();
      const updated = await db
        .update(bidSessions)
        .set({
          currentPhase: 'paused',
          pausedAt: now,
          mockControlRevision: sql`${bidSessions.mockControlRevision} + 1`,
        })
        .where(
          and(
            eq(bidSessions.id, id),
            ne(bidSessions.currentPhase, 'paused'),
            ne(bidSessions.currentPhase, 'complete'),
          ),
        )
        .returning({ id: bidSessions.id })
        .get();
      if (updated === undefined) return c.json({ error: 'session_state_changed' }, 409);
      await writeAuditLog(db, {
        bidSessionId: id,
        actorType: 'admin',
        actorId: actorIdFromClaims(c.get('claims')),
        action: 'pause',
        targetKind: 'bid_session',
        targetId: id,
        reason: body.reason,
        beforeState: { current_phase: current.currentPhase },
        afterState: { current_phase: 'paused' },
      });
      return c.json({ id, current_phase: 'paused', paused_at: now.toISOString() });
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

// POST /api/admin/bid-session/:id/resume
router.post(
  '/:id/resume',
  requireStepUpAuth(),
  zValidator('json', ResumeSessionSchema),
  async (c) => {
    const id = c.req.param('id');
    const db = getDb(c.env.DB);
    const s = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
    if (s === undefined) return c.json({ error: 'not_found' }, 404);
    if (await hasCanonicalCommandState(c.env, id)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    if (s.currentPhase !== 'paused') {
      return c.json({ error: 'invalid_state', current_phase: s.currentPhase }, 409);
    }
    const mutation = await runWithNormalBidMutationLease(c.env, id, async () => {
      if (await hasCanonicalCommandState(c.env, id)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      const current = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
      if (current === undefined) return c.json({ error: 'not_found' }, 404);
      if (current.currentPhase !== 'paused') {
        return c.json({ error: 'invalid_state', current_phase: current.currentPhase }, 409);
      }
      const updated = await db
        .update(bidSessions)
        .set({
          currentPhase: 'position_bid',
          pausedAt: null,
          mockControlRevision: sql`${bidSessions.mockControlRevision} + 1`,
        })
        .where(and(eq(bidSessions.id, id), eq(bidSessions.currentPhase, 'paused')))
        .returning({ id: bidSessions.id })
        .get();
      if (updated === undefined) return c.json({ error: 'session_state_changed' }, 409);
      await writeAuditLog(db, {
        bidSessionId: id,
        actorType: 'admin',
        actorId: actorIdFromClaims(c.get('claims')),
        action: 'resume',
        targetKind: 'bid_session',
        targetId: id,
        beforeState: { current_phase: 'paused' },
        afterState: { current_phase: 'position_bid' },
      });
      return c.json({ id, current_phase: 'position_bid' });
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

// POST /api/admin/bid-session/:id/day-end
router.post('/:id/day-end', requireStepUpAuth(), zValidator('json', DayEndSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
  if (s === undefined) return c.json({ error: 'not_found' }, 404);
  if (await hasCanonicalCommandState(c.env, id)) {
    return c.json({ error: 'canonical_mutation_requires_command' }, 409);
  }
  if (s.currentPhase === 'complete') {
    return c.json({ error: 'invalid_state', current_phase: 'complete' }, 409);
  }
  const mutation = await runWithNormalBidMutationLease(c.env, id, async () => {
    if (await hasCanonicalCommandState(c.env, id)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    const current = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
    if (current === undefined) return c.json({ error: 'not_found' }, 404);
    if (current.currentPhase === 'complete') {
      return c.json({ error: 'invalid_state', current_phase: 'complete' }, 409);
    }
    const resumeAt = new Date(body.scheduled_resume_at);
    const now = new Date();
    const updated = await db
      .update(bidSessions)
      .set({
        currentPhase: 'paused',
        pausedAt: now,
        scheduledResumeAt: resumeAt,
        mockControlRevision: sql`${bidSessions.mockControlRevision} + 1`,
      })
      .where(and(eq(bidSessions.id, id), ne(bidSessions.currentPhase, 'complete')))
      .returning({ id: bidSessions.id })
      .get();
    if (updated === undefined) return c.json({ error: 'session_state_changed' }, 409);
    await writeAuditLog(db, {
      bidSessionId: id,
      actorType: 'admin',
      actorId: actorIdFromClaims(c.get('claims')),
      action: 'pause',
      targetKind: 'bid_session',
      targetId: id,
      reason: body.reason,
      beforeState: { current_phase: current.currentPhase },
      afterState: { current_phase: 'paused', scheduled_resume_at: body.scheduled_resume_at },
    });
    return c.json({
      id,
      current_phase: 'paused',
      scheduled_resume_at: body.scheduled_resume_at,
    });
  });
  if (!mutation.ok) return c.json({ error: mutation.error }, 409);
  return mutation.value;
});

// POST /api/admin/bid-session/:id/day-start
router.post(
  '/:id/day-start',
  requireStepUpAuth(),
  zValidator('json', DayStartSchema),
  async (c) => {
    const id = c.req.param('id');
    const db = getDb(c.env.DB);
    const s = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
    if (s === undefined) return c.json({ error: 'not_found' }, 404);
    if (await hasCanonicalCommandState(c.env, id)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    if (s.currentPhase !== 'paused') {
      return c.json({ error: 'invalid_state', current_phase: s.currentPhase }, 409);
    }
    const mutation = await runWithNormalBidMutationLease(c.env, id, async () => {
      if (await hasCanonicalCommandState(c.env, id)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      const current = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
      if (current === undefined) return c.json({ error: 'not_found' }, 404);
      if (current.currentPhase !== 'paused') {
        return c.json({ error: 'invalid_state', current_phase: current.currentPhase }, 409);
      }
      const nextDayCount = current.dayCount + 1;
      const updated = await db
        .update(bidSessions)
        .set({
          currentPhase: 'position_bid',
          pausedAt: null,
          scheduledResumeAt: null,
          dayCount: nextDayCount,
          mockControlRevision: sql`${bidSessions.mockControlRevision} + 1`,
        })
        .where(and(eq(bidSessions.id, id), eq(bidSessions.currentPhase, 'paused')))
        .returning({ id: bidSessions.id })
        .get();
      if (updated === undefined) return c.json({ error: 'session_state_changed' }, 409);
      await writeAuditLog(db, {
        bidSessionId: id,
        actorType: 'admin',
        actorId: actorIdFromClaims(c.get('claims')),
        action: 'resume',
        targetKind: 'bid_session',
        targetId: id,
        beforeState: { current_phase: 'paused', day_count: current.dayCount },
        afterState: { current_phase: 'position_bid', day_count: nextDayCount },
      });
      return c.json({ id, current_phase: 'position_bid', day_count: nextDayCount });
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

// PATCH /api/admin/bid-session/:id/config  (immutable-session timer guard)
router.patch(
  '/:id/config',
  requireStepUpAuth(),
  zValidator('json', TimerConfigSchema),
  async (c) => {
    const id = c.req.param('id');
    const db = getDb(c.env.DB);
    const s = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
    if (s === undefined) return c.json({ error: 'not_found' }, 404);
    if (await hasCanonicalCommandState(c.env, id)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    const frozenPolicy = await loadFrozenSessionBidPolicy(db, id);
    if (!frozenPolicy.ok) {
      return c.json(
        {
          error: 'session_policy_snapshot_unavailable',
          policy_error: frozenPolicy.code,
        },
        409,
      );
    }
    return c.json(
      {
        error: 'session_configuration_managed_by_bid_year',
        configuration_revision: frozenPolicy.snapshot.configurationRevision,
        settings: {
          expected_duration_days: frozenPolicy.snapshot.settings.expectedDurationDays,
          turn_timer_seconds: frozenPolicy.snapshot.settings.turnTimerSeconds,
        },
      },
      409,
    );
  },
);

export default router;
