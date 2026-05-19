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
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { bidSessions } from '../../db/schema.js';
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

export default router;
