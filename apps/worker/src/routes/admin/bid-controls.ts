import { zValidator } from '@hono/zod-validator';
import { ForcePickSchema, type JwtPayload, SkipSchema } from '@mbfd/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { getDb } from '../../db/index.js';
import { bidSessions, bids, members } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { isReasonValidForAction } from '../../lib/reason-codes.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

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

    const member = await db.select().from(members).where(eq(members.id, body.member_id)).get();
    if (member === undefined) return c.json({ error: 'member_not_found' }, 404);

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
    const adminActorId = claims.sub > 0 ? claims.sub : 0;
    const now = new Date();

    // Next ordinal (max+1 in session). Best-effort — final serialization is
    // the BidSession DO's job; this REST path is for offline admin overrides.
    const maxOrdRow = await db
      .select({ m: sql<number | null>`max(${bids.ordinal})` })
      .from(bids)
      .where(eq(bids.bidSessionId, sessionId))
      .get();
    const ordinal = (maxOrdRow?.m ?? 0) + 1;

    await db.insert(bids).values({
      id: bidId,
      bidSessionId: sessionId,
      ordinal,
      memberId: body.member_id,
      positionId: body.position_id,
      pickedAt: now,
      forced: true,
      adminActorId,
      reason: body.reason,
      idempotencyKey: idemKey,
      portalSyncStatus: 'pending',
      portalSyncAttempts: 0,
    });

    await writeAuditLog(db, {
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
    });

    return c.json({ bid_id: bidId, forced: true }, 201);
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

  const member = await db.select().from(members).where(eq(members.id, body.member_id)).get();
  if (member === undefined) return c.json({ error: 'member_not_found' }, 404);

  const claims = c.get('claims');
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

export default router;
