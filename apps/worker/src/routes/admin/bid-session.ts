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
import { desc, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  hasCanonicalBidSessionState,
  loadCanonicalBidSessionState,
} from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidSessions, bidYears } from '../../db/schema.js';
import type { BidSessionState } from '../../durable/bid-session-state.js';
import { writeAuditLog } from '../../lib/audit.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const CreateSessionSchema = z.object({
  bid_year: z.number().int().min(2024).max(2100),
  expected_duration_days: z.number().int().min(1).max(7).default(2),
  turn_timer_seconds: z.number().int().min(30).max(600).default(180),
  is_mock: z.boolean().optional().default(false),
});

function actorIdFromClaims(claims: JwtPayload): number | null {
  return claims.sub > 0 ? claims.sub : null;
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
  await db.insert(bidSessions).values({
    id,
    bidYear: body.bid_year,
    startedAt: now,
    currentPhase: 'config',
    turnTimerSeconds: body.turn_timer_seconds,
    expectedDurationDays: body.expected_duration_days,
    dayCount: 0,
    isMock: body.is_mock,
  });
  await writeAuditLog(db, {
    bidSessionId: id,
    actorType: 'admin',
    actorId: actorIdFromClaims(c.get('claims')),
    action: 'session_start',
    targetKind: 'bid_session',
    targetId: id,
    afterState: { bid_year: body.bid_year, current_phase: 'config', is_mock: body.is_mock },
  });
  return c.json({ id, current_phase: 'config', is_mock: body.is_mock }, 201);
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
  if (!s.isMock) {
    const readiness = evaluateUnconfiguredLiveReadiness();
    if (!readiness.canStartLiveBid) {
      return c.json({ error: 'readiness_blocked', readiness }, 409);
    }
  }
  const now = new Date();
  await db
    .update(bidSessions)
    .set({ currentPhase: 'position_bid', startedAt: now })
    .where(eq(bidSessions.id, id));
  await writeAuditLog(db, {
    bidSessionId: id,
    actorType: 'admin',
    actorId: actorIdFromClaims(c.get('claims')),
    action: 'session_start',
    targetKind: 'bid_session',
    targetId: id,
    beforeState: { current_phase: 'config' },
    afterState: { current_phase: 'position_bid' },
  });
  return c.json({ id, current_phase: 'position_bid' });
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
    const now = new Date();
    await db
      .update(bidSessions)
      .set({ currentPhase: 'paused', pausedAt: now })
      .where(eq(bidSessions.id, id));
    await writeAuditLog(db, {
      bidSessionId: id,
      actorType: 'admin',
      actorId: actorIdFromClaims(c.get('claims')),
      action: 'pause',
      targetKind: 'bid_session',
      targetId: id,
      reason: body.reason,
      beforeState: { current_phase: s.currentPhase },
      afterState: { current_phase: 'paused' },
    });
    return c.json({ id, current_phase: 'paused', paused_at: now.toISOString() });
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
    await db
      .update(bidSessions)
      .set({ currentPhase: 'position_bid', pausedAt: null })
      .where(eq(bidSessions.id, id));
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
  const resumeAt = new Date(body.scheduled_resume_at);
  const now = new Date();
  await db
    .update(bidSessions)
    .set({ currentPhase: 'paused', pausedAt: now, scheduledResumeAt: resumeAt })
    .where(eq(bidSessions.id, id));
  await writeAuditLog(db, {
    bidSessionId: id,
    actorType: 'admin',
    actorId: actorIdFromClaims(c.get('claims')),
    action: 'pause',
    targetKind: 'bid_session',
    targetId: id,
    reason: body.reason,
    beforeState: { current_phase: s.currentPhase },
    afterState: { current_phase: 'paused', scheduled_resume_at: body.scheduled_resume_at },
  });
  return c.json({
    id,
    current_phase: 'paused',
    scheduled_resume_at: body.scheduled_resume_at,
  });
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
    await db
      .update(bidSessions)
      .set({
        currentPhase: 'position_bid',
        pausedAt: null,
        scheduledResumeAt: null,
        dayCount: s.dayCount + 1,
      })
      .where(eq(bidSessions.id, id));
    await writeAuditLog(db, {
      bidSessionId: id,
      actorType: 'admin',
      actorId: actorIdFromClaims(c.get('claims')),
      action: 'resume',
      targetKind: 'bid_session',
      targetId: id,
      beforeState: { current_phase: 'paused', day_count: s.dayCount },
      afterState: { current_phase: 'position_bid', day_count: s.dayCount + 1 },
    });
    return c.json({ id, current_phase: 'position_bid', day_count: s.dayCount + 1 });
  },
);

// PATCH /api/admin/bid-session/:id/config  (live timer adjustment)
router.patch(
  '/:id/config',
  requireStepUpAuth(),
  zValidator('json', TimerConfigSchema),
  async (c) => {
    const id = c.req.param('id');
    const { turn_timer_seconds } = c.req.valid('json');
    const db = getDb(c.env.DB);
    const s = await db.select().from(bidSessions).where(eq(bidSessions.id, id)).get();
    if (s === undefined) return c.json({ error: 'not_found' }, 404);
    if (await hasCanonicalCommandState(c.env, id)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    await db
      .update(bidSessions)
      .set({ turnTimerSeconds: turn_timer_seconds })
      .where(eq(bidSessions.id, id));
    await writeAuditLog(db, {
      bidSessionId: id,
      actorType: 'admin',
      actorId: actorIdFromClaims(c.get('claims')),
      action: 'override_rule',
      targetKind: 'bid_session_config',
      targetId: id,
      beforeState: { turn_timer_seconds: s.turnTimerSeconds },
      afterState: { turn_timer_seconds },
    });
    return c.json({ id, turn_timer_seconds });
  },
);

export default router;
