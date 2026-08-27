// apps/worker/src/routes/admin/force-a-day.ts
//
// Plan 07 Task 14: admin force-a-day route. Bypasses the officer invariant
// and capacity-full gate; still rejects ALREADY_PICKED + NO_PHASE_1_PICK.
// Step-up auth required; audit row written with forced=true and reason.

import type { ADayValue, Member } from '@mbfd/a-day';
import { ADayValueSchema, type JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { hasCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { aDayPicks, bidSessions, members as membersTable } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const ForceADayBodySchema = z.object({
  member_id: z.number().int().positive(),
  a_day: ADayValueSchema,
  reason: z.string().min(8).max(500),
});

const router = new Hono<Env>();
router.use('*', requireAdmin);

/**
 * POST /api/admin/bid-session/:id/force-a-day
 * Body: { member_id, a_day, reason }
 * Forces an A-Day pick for the given member; bypasses canPick gates but
 * still rejects ALREADY_PICKED and NO_PHASE_1_PICK. Writes audit + persists
 * via the DO so the broadcast is consistent.
 */
router.post('/:id/force-a-day', requireStepUpAuth(), async (c) => {
  const sessionId = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const parsed = ForceADayBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400);
  }

  const db = getDb(c.env.DB);
  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
    return c.json({ error: 'canonical_mutation_requires_command' }, 409);
  }
  if (session.currentPhase !== 'a_day_bid') {
    return c.json(
      {
        type: 'a_day_reject',
        v: 1,
        memberId: parsed.data.member_id,
        reasonCode: 'PHASE_NOT_A_DAY_BID',
        reasonLabel: `Phase 2 is not active (phase=${session.currentPhase}).`,
      },
      409,
    );
  }

  // Load full member roster so the DO has rank info for downstream meters.
  const memberRows = await db.select().from(membersTable);
  const members: Member[] = memberRows.map((m) => ({
    employeeId: String(m.id),
    firstName: m.firstName,
    lastName: m.lastName,
    rank: m.rank,
    rscSeniority: m.rscSeniority,
    rankSeniority: m.rankSeniority ?? undefined,
    isProbationary: m.isProbationary,
    credentials: [],
  }));

  const claims = c.get('claims');
  const adminActorId = claims.sub > 0 ? claims.sub : 0;
  const idemKey = c.req.header('Idempotency-Key')?.trim() || ulid();

  // Forward to the DO. Forced=true is passed through; the DO handler bypasses
  // canPick when input.forced is set.
  const doId = c.env.BID_SESSION.idFromName(sessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const doResp = await stub.fetch(`${new URL(c.req.url).origin}/submit-a-day-pick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      senderMemberId: parsed.data.member_id,
      aDay: parsed.data.a_day as ADayValue,
      idempotencyKey: idemKey,
      members,
      forced: true,
      adminActorId,
      reason: parsed.data.reason,
    }),
  });
  const json = (await doResp.json()) as { kind: string; code?: string; pick?: unknown };
  if (json.kind === 'rejected') {
    return c.json(json, 409);
  }
  // Persist to D1 + audit. (The DO already persisted its in-memory state.)
  const pick = json.pick as {
    memberId: number;
    shift: 'A' | 'B' | 'C' | 'D';
    aDay: string;
    pickedAtMs: number;
    forced: boolean;
    adminActorId: number | null;
  };
  await db.insert(aDayPicks).values({
    id: ulid(),
    bidSessionId: sessionId,
    memberId: pick.memberId,
    shift: pick.shift,
    aDay: pick.aDay,
    pickedAtMs: pick.pickedAtMs,
    forced: pick.forced,
    adminActorId: pick.adminActorId,
    reason: parsed.data.reason,
    idempotencyKey: idemKey,
  });
  await writeAuditLog(db, {
    bidSessionId: sessionId,
    actorType: 'admin',
    actorId: adminActorId,
    action: 'forced_a_day_pick',
    targetKind: 'a_day',
    targetId: parsed.data.a_day,
    reason: parsed.data.reason,
    afterState: {
      member_id: pick.memberId,
      a_day: pick.aDay,
      forced: true,
    },
  });
  return c.json(json, 200);
});

export default router;
