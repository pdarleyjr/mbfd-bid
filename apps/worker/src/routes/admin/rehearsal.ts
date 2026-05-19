// Plan 09 / Rehearsal Tooling — admin endpoints for mock-draft sessions.
//
// Routes:
//   POST   /api/admin/rehearsal/:sessionId/mark-mock   (Task R3)
//   POST   /api/admin/rehearsal/:sessionId/reset-mock  (Task R4)
//   POST   /api/admin/rehearsal/:sessionId/auto-bid    (Task R5)
//   POST   /api/admin/rehearsal/findings               (Task R6)
//   GET    /api/admin/rehearsal/findings?session_id=…  (Task R6)
//
// All routes require admin role (`requireAdmin`). Mark-mock is intentionally
// NOT behind `requireStepUpAuth` because it is a no-op until the operator
// also runs reset-mock / auto-bid (which themselves are 403 unless is_mock=1).

import type { JwtPayload } from '@mbfd/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { aDayPicks, bidOrder, bidSessions, bids } from '../../db/schema.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

/**
 * Task R3 — POST /api/admin/rehearsal/:sessionId/mark-mock
 *
 * Idempotently sets `bid_sessions.is_mock = 1` for the given session. This
 * MUST be done BEFORE any picks happen — once a session is marked mock, the
 * portal-writeback consumer (Task R8) will skip every bid in it.
 *
 * Returns 404 if the session does not exist. 200 on success (whether or not
 * it was already marked).
 */
router.post('/:sessionId/mark-mock', async (c) => {
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (s.isMock) {
    return c.json({ id: sessionId, is_mock: true, idempotent: true });
  }
  await db.update(bidSessions).set({ isMock: true }).where(eq(bidSessions.id, sessionId));
  return c.json({ id: sessionId, is_mock: true, idempotent: false });
});

/**
 * Task R4 — POST /api/admin/rehearsal/:sessionId/reset-mock
 *
 * Wipes Phase 1 bids + Phase 2 a_day picks, rewinds the session row to the
 * starting `position_bid` state, and asks the BidSession DO to reset its
 * in-memory + persisted state. The audit chain is intentionally NOT touched:
 * the rehearsal record itself is part of the legal trail.
 *
 * Returns 403 if the session isn't marked mock. 404 if it doesn't exist.
 * 204 on success (no body).
 */
router.post('/:sessionId/reset-mock', async (c) => {
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (!s.isMock) {
    return c.json({ error: 'not_a_mock_session' }, 403);
  }

  // Order matters: clear child rows first to avoid FK conflicts in production
  // D1 (test harness disables FKs, but production keeps them on).
  await db.delete(bids).where(eq(bids.bidSessionId, sessionId));
  await db.delete(aDayPicks).where(eq(aDayPicks.bidSessionId, sessionId));

  // Pick the first ordinal as the next current bidder. If the session has no
  // bid_order yet (never started) we leave currentBidderId null.
  const firstInOrder = await db
    .select()
    .from(bidOrder)
    .where(eq(bidOrder.bidSessionId, sessionId))
    .orderBy(asc(bidOrder.ordinal))
    .get();

  await db
    .update(bidSessions)
    .set({
      currentPhase: 'position_bid',
      currentBidderId: firstInOrder?.memberId ?? null,
      currentTurnStartedAt: null,
      pausedAt: null,
      completedAt: null,
      frozenAt: null,
    })
    .where(eq(bidSessions.id, sessionId));

  // Best-effort: tell the DO to wipe its in-memory state. If BID_SESSION is
  // a test stub, the call may throw — we swallow so the D1 reset still
  // surfaces as 204 to the admin.
  try {
    const doId = c.env.BID_SESSION.idFromName(sessionId);
    const stub = c.env.BID_SESSION.get(doId);
    await stub.fetch(new Request('http://do/reset-mock', { method: 'POST' }));
  } catch (err) {
    console.error('[rehearsal] DO reset-mock call failed (best-effort)', err);
  }

  return new Response(null, { status: 204 });
});

export default router;
