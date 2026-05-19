import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import { BidForMemberSchema, ForcePickSchema, type JwtPayload, SkipSchema } from '@mbfd/shared';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { type DB, getDb } from '../../db/index.js';
import {
  bidSessions,
  bids,
  credentials,
  memberCredentials,
  members,
  positionRules,
  ruleBooks,
} from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { isReasonValidForAction } from '../../lib/reason-codes.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

async function loadMemberWithCreds(db: DB, memberId: number) {
  const m = await db.select().from(members).where(eq(members.id, memberId)).get();
  if (m === undefined) return null;
  const memberCreds = await db
    .select({ name: credentials.name })
    .from(memberCredentials)
    .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
    .where(eq(memberCredentials.memberId, memberId))
    .all();
  return {
    employeeId: m.employeeId,
    firstName: m.firstName,
    lastName: m.lastName,
    rank: m.rank,
    rscSeniority: m.rscSeniority,
    rankSeniority: m.rankSeniority ?? undefined,
    isProbationary: m.isProbationary,
    credentials: memberCreds.map((c) => ({ name: c.name })),
  };
}

async function loadActiveRule(db: DB, positionId: string, effectiveYear: number) {
  const ruleBook = await db
    .select()
    .from(ruleBooks)
    .where(and(eq(ruleBooks.effectiveYear, effectiveYear), eq(ruleBooks.status, 'active')))
    .get();
  if (ruleBook === undefined) return null;
  const r = await db
    .select()
    .from(positionRules)
    .where(
      and(
        eq(positionRules.positionId, positionId),
        eq(positionRules.ruleBookVersion, ruleBook.version),
      ),
    )
    .get();
  if (r === undefined) return null;
  return {
    positionId: r.positionId,
    ruleBookVersion: r.ruleBookVersion,
    requiredCriteria: JSON.parse(r.requiredCriteriaJson),
    pointsPreference: JSON.parse(r.pointsPreferenceJson),
    tieBreakChain: JSON.parse(r.tieBreakChainJson),
  };
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

    const member = await loadMemberWithCreds(db, body.member_id);
    if (member === null) return c.json({ error: 'member_not_found' }, 404);

    const rule = await loadActiveRule(db, body.position_id, session.bidYear);
    if (rule === null) return c.json({ error: 'rule_not_found_for_active_book' }, 404);

    const evalResult = evaluateEligibility(member, rule);
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
    const adminActorId = claims.sub > 0 ? claims.sub : 0;
    const bidId = ulid();

    await db.insert(bids).values({
      id: bidId,
      bidSessionId: sessionId,
      ordinal: 0, // DO assigns the real ordinal at Plan 04 time; we use 0 as placeholder
      memberId: body.member_id,
      positionId: body.position_id,
      aDay: body.a_day ?? null,
      pickedAt: new Date(),
      forced: false,
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
    });

    return c.json({ bid_id: bidId, forced: false }, 201);
  },
);

export default router;
