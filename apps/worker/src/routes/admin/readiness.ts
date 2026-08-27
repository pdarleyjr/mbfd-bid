// W-MOCKSAFETY — Cutover safety readiness probe.
//
// Plan 09 Phase E's cutover script must verify that NO mock (rehearsal)
// sessions are still alive before flipping DNS. This endpoint returns the
// definitive answer: `{ ok, openMockSessions }`.

import type { JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { loadCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidSessions } from '../../db/schema.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

/**
 * GET /api/admin/readiness/no-mock-sessions
 *
 * Returns `{ ok: true, openMockSessions: [] }` when every `is_mock=1`
 * session is in a closed phase (`complete` or `archived`). Returns
 * `{ ok: false, openMockSessions: [<id>, ...] }` otherwise.
 *
 * Note: there is no `archived` phase in the current `current_phase` enum —
 * archived sessions are represented by `current_phase = 'complete'` plus
 * an explicit operator decision. We therefore treat `complete` as the only
 * closed phase until the schema defines an archival lifecycle explicitly.
 */
router.get('/no-mock-sessions', async (c) => {
  const db = getDb(c.env.DB);
  const sessions = await db
    .select({ id: bidSessions.id, currentPhase: bidSessions.currentPhase })
    .from(bidSessions)
    .where(eq(bidSessions.isMock, true))
    .all();
  let openMockSessions: string[];
  try {
    const effective = await Promise.all(
      sessions.map(async (session) => {
        const canonical = await loadCanonicalBidSessionState(c.env.DB, session.id);
        return { id: session.id, currentPhase: canonical?.currentPhase ?? session.currentPhase };
      }),
    );
    openMockSessions = effective
      .filter((session) => session.currentPhase !== 'complete')
      .map((session) => session.id);
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }
  return c.json({ ok: openMockSessions.length === 0, openMockSessions });
});

export default router;
