import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import {
  BidForMemberSchema,
  ForcePickSchema,
  type JwtPayload,
  LockPositionSchema,
  SkipSchema,
} from '@mbfd/shared';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { hasCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
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
import { decodeRuleBookRows } from '../../lib/position-rule.js';
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

type ActiveRuleLoadResult =
  | { kind: 'not_found' }
  | {
      kind: 'invalid';
      invalidPositionIds: readonly string[];
      duplicatePositionIds: readonly string[];
    }
  | { kind: 'ok'; rule: ReturnType<typeof decodeRuleBookRows>['rules'][number] };

async function loadActiveRule(
  db: DB,
  positionId: string,
  effectiveYear: number,
): Promise<ActiveRuleLoadResult> {
  const ruleBook = await db
    .select()
    .from(ruleBooks)
    .where(and(eq(ruleBooks.effectiveYear, effectiveYear), eq(ruleBooks.status, 'active')))
    .get();
  if (ruleBook === undefined) return { kind: 'not_found' };
  const rows = await db
    .select()
    .from(positionRules)
    .where(eq(positionRules.ruleBookVersion, ruleBook.version))
    .all();
  const decodedRuleBook = decodeRuleBookRows(rows);
  if (
    rows.length === 0 ||
    decodedRuleBook.invalidPositionIds.length > 0 ||
    decodedRuleBook.duplicatePositionIds.length > 0
  ) {
    return {
      kind: 'invalid',
      invalidPositionIds: decodedRuleBook.invalidPositionIds,
      duplicatePositionIds: decodedRuleBook.duplicatePositionIds,
    };
  }
  const rule = decodedRuleBook.rules.find((entry) => entry.positionId === positionId);
  return rule === undefined ? { kind: 'not_found' } : { kind: 'ok', rule };
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
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }

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
  if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
    return c.json({ error: 'canonical_mutation_requires_command' }, 409);
  }

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
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }

    const member = await loadMemberWithCreds(db, body.member_id);
    if (member === null) return c.json({ error: 'member_not_found' }, 404);

    const loadedRule = await loadActiveRule(db, body.position_id, session.bidYear);
    if (loadedRule.kind === 'not_found') {
      return c.json({ error: 'rule_not_found_for_active_book' }, 404);
    }
    if (loadedRule.kind === 'invalid') {
      return c.json(
        {
          error: 'active_rule_book_invalid',
          invalid_position_ids: loadedRule.invalidPositionIds,
          duplicate_position_ids: loadedRule.duplicatePositionIds,
        },
        409,
      );
    }

    const evalResult = evaluateEligibility(member, loadedRule.rule);
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

// POST /api/admin/bid-session/:id/lock-position
router.post(
  '/:id/lock-position',
  requireStepUpAuth(),
  zValidator('json', LockPositionSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const body = c.req.valid('json');

    if (!isReasonValidForAction('lock_position', body.reason_code)) {
      return c.json(
        {
          error: 'invalid_reason_for_action',
          action: 'lock_position',
          reason_code: body.reason_code,
        },
        400,
      );
    }

    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (await hasCanonicalBidSessionState(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    if (session.currentPhase !== 'config') {
      return c.json(
        { error: 'locks_only_in_config_phase', current_phase: session.currentPhase },
        409,
      );
    }

    const cfg: { position_locks?: { position_id: string; member_id: number }[] } =
      session.configJson !== null && session.configJson !== ''
        ? JSON.parse(session.configJson)
        : {};
    cfg.position_locks = Array.isArray(cfg.position_locks) ? cfg.position_locks : [];
    const conflict = cfg.position_locks.find((l) => l.position_id === body.position_id);
    if (conflict !== undefined) {
      return c.json({ error: 'position_already_locked', existing: conflict }, 409);
    }
    cfg.position_locks.push({ position_id: body.position_id, member_id: body.member_id });

    await db
      .update(bidSessions)
      .set({ configJson: JSON.stringify(cfg) })
      .where(eq(bidSessions.id, sessionId));

    const claims = c.get('claims');
    await writeAuditLog(db, {
      bidSessionId: sessionId,
      actorType: 'admin',
      actorId: claims.sub > 0 ? claims.sub : 0,
      action: 'lock_position',
      targetKind: 'position',
      targetId: body.position_id,
      reason: body.reason,
      afterState: { member_id: body.member_id, reason_code: body.reason_code },
    });

    return c.json({
      position_id: body.position_id,
      member_id: body.member_id,
      reason_code: body.reason_code,
    });
  },
);

export default router;
