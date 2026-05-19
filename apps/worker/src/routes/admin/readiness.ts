// W-MOCKSAFETY — Cutover safety readiness probe.
//
// Plan 09 Phase E's cutover script must verify that NO mock (rehearsal)
// sessions are still alive before flipping DNS. This endpoint returns the
// definitive answer: `{ ok, openMockSessions }`.

import type { JwtPayload } from '@mbfd/shared';
import { and, eq, inArray, not } from 'drizzle-orm';
import { Hono } from 'hono';
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
 * an explicit operator decision. We treat `complete` as the only closed
 * phase. If the schema later grows an `archived` value, this list
 * automatically expands.
 */
const CLOSED_PHASES = ['complete'] as const;

router.get('/no-mock-sessions', async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select({ id: bidSessions.id })
    .from(bidSessions)
    .where(
      and(
        eq(bidSessions.isMock, true),
        not(
          inArray(
            bidSessions.currentPhase,
            CLOSED_PHASES as unknown as (typeof bidSessions.currentPhase.enumValues)[number][],
          ),
        ),
      ),
    )
    .all();
  const openMockSessions = rows.map((r) => r.id);
  return c.json({ ok: openMockSessions.length === 0, openMockSessions });
});

export default router;
