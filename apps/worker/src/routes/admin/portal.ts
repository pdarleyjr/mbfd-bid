// Plan 08 Task 24 — Admin endpoints for manual portal write-back operations.
//
//   POST /portal-retry/:bid_id        Reset a failed bid to pending so the
//                                     reconciliation cron picks it up.
//   GET  /portal-status/:session_id   List bids with pending/failed status.
//   POST /portal-clear-year           Mark all bids in a year as superseded
//                                     (e.g., when re-running a corrupted bid).
//                                     Requires dual confirmation phrase.

import type { JwtPayload } from '@mbfd/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDb } from '../../db/index.js';
import { bidSessions, bids, portalWritebackQueue } from '../../db/schema.js';
import { chunkedInArrayMutate, chunkedInArraySelect } from '../../lib/d1-batch.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import { isPortalPublicationEnabled } from '../../portal-writeback/publication-policy.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.post('/portal-retry/:bid_id', requireStepUpAuth(), async (c) => {
  const bidId = c.req.param('bid_id');
  if (!bidId) return c.json({ error: 'bid_id_required' }, 400);
  if (!isPortalPublicationEnabled(c.env)) {
    return c.json({ error: 'portal_writeback_disabled' }, 409);
  }
  const db = getDb(c.env.DB);
  const bid = await db.select().from(bids).where(eq(bids.id, bidId)).get();
  if (!bid) return c.json({ error: 'not_found' }, 404);
  if (bid.portalSyncStatus !== 'failed') {
    return c.json({ error: 'portal_retry_requires_failed_bid' }, 409);
  }
  await db
    .update(bids)
    .set({ portalSyncStatus: 'pending', portalSyncAttempts: 0, portalLastError: null })
    .where(eq(bids.id, bidId));
  // Reset any orphan queue row to queued so the daily reconciliation re-emits it.
  await db
    .update(portalWritebackQueue)
    .set({ status: 'queued', attempts: 0, lastError: null })
    .where(eq(portalWritebackQueue.bidId, bidId));
  return c.json({ ok: true, bid_id: bidId });
});

router.get('/portal-status/:session_id', async (c) => {
  const sid = c.req.param('session_id');
  if (!sid) return c.json({ error: 'session_id_required' }, 400);
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(bids)
    .where(and(eq(bids.bidSessionId, sid), inArray(bids.portalSyncStatus, ['pending', 'failed'])))
    .all();
  return c.json({ bids: rows });
});

const ClearYearBody = z.object({
  year: z.number().int().min(2024).max(2099),
  confirmation_phrase: z.string(),
});

router.post('/portal-clear-year', requireStepUpAuth(), async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = ClearYearBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const expectedPhrase = `CLEAR YEAR ${body.year}`;
  if (body.confirmation_phrase !== expectedPhrase) {
    return c.json({ error: 'confirmation_phrase_mismatch', expected: expectedPhrase }, 400);
  }
  const db = getDb(c.env.DB);
  const sessions = await db
    .select({ id: bidSessions.id })
    .from(bidSessions)
    .where(eq(bidSessions.bidYear, body.year))
    .all();
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return c.json({ cleared: 0 });

  // Chunk every IN-list — a year's bids can easily exceed D1's per-statement
  // placeholder cap when there are 200+ positions across N sessions.
  const affected = await chunkedInArraySelect(sessionIds, (chunk) =>
    db.select({ id: bids.id }).from(bids).where(inArray(bids.bidSessionId, chunk)).all(),
  );
  const affectedIds = affected.map((a) => a.id);

  await chunkedInArrayMutate(sessionIds, (chunk) =>
    db
      .update(bids)
      .set({ portalSyncStatus: 'superseded' })
      .where(inArray(bids.bidSessionId, chunk)),
  );

  if (affectedIds.length > 0) {
    await chunkedInArrayMutate(affectedIds, (chunk) =>
      db.delete(portalWritebackQueue).where(inArray(portalWritebackQueue.bidId, chunk)),
    );
  }
  return c.json({ cleared: affectedIds.length });
});

export default router;
