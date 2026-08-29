// Plan 09 / Rehearsal Tooling — admin endpoints for mock-draft sessions.
//
// Routes:
//   POST   /api/admin/rehearsal/:sessionId/mark-mock   (Task R3)
//   POST   /api/admin/rehearsal/:sessionId/reset-mock  (Task R4)
//   POST   /api/admin/rehearsal/:sessionId/auto-bid    (Task R5)
//   POST   /api/admin/rehearsal/findings               (Task R6)
//   GET    /api/admin/rehearsal/findings?session_id=…  (Task R6)
//
// All routes require admin role (`requireAdmin`). Mark-mock is a privileged,
// audited reclassification and therefore also requires fresh step-up auth.

import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { type JwtPayload, MockFreezeCommandSchema, MockFreezeRequestSchema } from '@mbfd/shared';
import { and, asc, desc, eq, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { loadCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import type { DB } from '../../db/index.js';
import {
  aDayPicks,
  bidOrder,
  bidSessions,
  bids,
  canonicalBidSessionState,
  mockRehearsalCommandReceipts,
  rehearsalFindings,
} from '../../db/schema.js';
import { canonicalize, type JsonValue } from '../../audit/canonical-json.js';
import { writeAuditLog } from '../../lib/audit.js';
import { computeBidOrder } from '../../lib/bid-order.js';
import {
  bidOrderInputFromSnapshot,
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadFrozenSessionBidPolicy,
} from '../../lib/bid-policy.js';
import { runWithNormalBidMutationLease } from '../../lib/specialty-interruption-guard.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

const IdempotencyKeyHeaderSchema = z.string().uuid();

function orderMatchesFrozenSnapshot(
  persisted: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
  expected: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
): boolean {
  return (
    persisted.length === expected.length &&
    persisted.every((entry, index) => {
      const candidate = expected[index];
      return (
        candidate !== undefined &&
        entry.ordinal === candidate.ordinal &&
        entry.memberId === candidate.memberId &&
        entry.pool === candidate.pool
      );
    })
  );
}

/**
 * Task R3 — POST /api/admin/rehearsal/:sessionId/mark-mock
 *
 * Idempotently sets `bid_sessions.is_mock = 1` only while a session is still
 * in config and has no picks. Once a session has started, it can never be
 * reclassified to evade live-start or portal-writeback protections.
 *
 * Returns 404 if the session does not exist. 200 on success (whether or not
 * it was already marked).
 */
router.post('/:sessionId/mark-mock', requireStepUpAuth(), async (c) => {
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (s.isMock) {
    return c.json({ id: sessionId, is_mock: true, idempotent: true });
  }
  if (s.currentPhase !== 'config') {
    return c.json(
      { error: 'mock_reclassification_not_allowed', current_phase: s.currentPhase },
      409,
    );
  }

  const [bidCount, aDayPickCount] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(bids)
      .where(eq(bids.bidSessionId, sessionId))
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(aDayPicks)
      .where(eq(aDayPicks.bidSessionId, sessionId))
      .get(),
  ]);
  if ((bidCount?.count ?? 0) > 0 || (aDayPickCount?.count ?? 0) > 0) {
    return c.json({ error: 'mock_reclassification_not_allowed', detail: 'session_has_picks' }, 409);
  }

  const updated = await db
    .update(bidSessions)
    .set({ isMock: true })
    .where(
      and(
        eq(bidSessions.id, sessionId),
        eq(bidSessions.isMock, false),
        eq(bidSessions.currentPhase, 'config'),
        notExists(db.select({ id: bids.id }).from(bids).where(eq(bids.bidSessionId, sessionId))),
        notExists(
          db
            .select({ bidSessionId: aDayPicks.bidSessionId })
            .from(aDayPicks)
            .where(eq(aDayPicks.bidSessionId, sessionId)),
        ),
      ),
    )
    .returning();
  const after = updated[0];
  if (after === undefined) {
    const current = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (current?.isMock) return c.json({ id: sessionId, is_mock: true, idempotent: true });
    return c.json({ error: 'mock_reclassification_not_allowed' }, 409);
  }

  const claims = c.get('claims');
  await writeAuditLog(db, {
    bidSessionId: sessionId,
    actorType: 'admin',
    actorId: claims.sub > 0 ? claims.sub : null,
    action: 'mark_mock',
    targetKind: 'bid_session',
    targetId: sessionId,
    reason: 'Session designated mock before start.',
    beforeState: s,
    afterState: after,
  });
  return c.json({ id: sessionId, is_mock: true, idempotent: false });
});

/**
 * Rehearsal-only command boundary proof. It gates on the existing D1 mock
 * designation, then forwards a typed, authenticated command to the named DO.
 * No bid_sessions freeze column is written here, and D1/R2 audit work remains
 * outside the DO-local state/receipt transaction.
 */
router.post(
  '/:sessionId/commands/freeze',
  requireStepUpAuth(),
  zValidator('json', MockFreezeRequestSchema),
  async (c) => {
    const commandId = IdempotencyKeyHeaderSchema.safeParse(c.req.header('Idempotency-Key'));
    if (!commandId.success) return c.json({ error: 'missing_idempotency_key' }, 400);

    const sessionId = c.req.param('sessionId');
    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (!session.isMock) return c.json({ error: 'not_a_mock_session' }, 403);

    // A canonical command may seed only a fresh mock. Legacy position/A-Day
    // writes lack a lossless command/event mapping, so forwarding them would
    // falsely make a partial D1 snapshot authoritative. The D1 trigger in
    // migration 0022 repeats this check inside the actual commit boundary.
    if (!(await hasCanonicalSessionState(db, sessionId))) {
      const [legacyBid, legacyADayPick] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(bids)
          .where(eq(bids.bidSessionId, sessionId))
          .get(),
        db
          .select({ count: sql<number>`count(*)` })
          .from(aDayPicks)
          .where(eq(aDayPicks.bidSessionId, sessionId))
          .get(),
      ]);
      if ((legacyADayPick?.count ?? 0) > 0) {
        return c.json({ error: 'canonical_seed_requires_a_day_import' }, 409);
      }
      if ((legacyBid?.count ?? 0) > 0) {
        return c.json({ error: 'canonical_seed_requires_pristine_mock' }, 409);
      }
    }

    const body = c.req.valid('json');
    const claims = c.get('claims');
    const command = MockFreezeCommandSchema.parse({
      v: 1,
      type: 'mock.freeze',
      commandId: commandId.data,
      bidSessionId: sessionId,
      expectedSeq: body.expectedSeq,
      actor: { id: claims.sub, role: 'admin' },
      reason: body.reason,
    });

    const doId = c.env.BID_SESSION.idFromName(sessionId);
    const stub = c.env.BID_SESSION.get(doId);
    const response = await stub.fetch('https://do/admin/commands/mock-freeze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  },
);

/**
 * Task R4 — POST /api/admin/rehearsal/:sessionId/reset-mock
 *
 * Reset is fail-closed while canonical mock commands are enabled. An audited,
 * serialized reset epoch is required before this destructive operation can be
 * safely re-enabled.
 *
 * Returns 403 if the session isn't marked mock. 404 if it doesn't exist.
 * 409 until the reset epoch exists.
 */
router.post('/:sessionId/reset-mock', async (c) => {
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (!s.isMock) {
    return c.json({ error: 'not_a_mock_session' }, 403);
  }
  return c.json({ error: 'canonical_reset_requires_new_epoch' }, 409);
});

const AutoBidBodySchema = z.object({
  count: z.number().int().positive().max(200),
  strategy: z.literal('first_eligible'),
  expected_mock_control_revision: z.number().int().nonnegative(),
});

const RehearsalIdempotencyKeySchema = z.string().trim().min(1).max(160);

type MockRehearsalOperation = 'auto_bid' | 'manual_pick';

type MockRehearsalReceiptDecision =
  | { readonly kind: 'new' }
  | { readonly kind: 'replay'; readonly response: Response }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'outcome_unknown' };

function rehearsalCommandFingerprint(
  operation: MockRehearsalOperation,
  sessionId: string,
  actorSubject: string,
  expectedMockControlRevision: number,
  payload: JsonValue,
): string {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        canonicalize({
          fingerprint_version: 1,
          operation,
          session_id: sessionId,
          actor_subject: actorSubject,
          expected_mock_control_revision: expectedMockControlRevision,
          payload,
        }),
      ),
    ),
  );
}

function replayResponse(responseJson: string, responseStatus: number): Response {
  return new Response(responseJson, {
    status: responseStatus,
    headers: {
      'content-type': 'application/json',
      'x-mbfd-idempotent-replay': 'true',
    },
  });
}

async function inspectMockRehearsalReceipt(
  db: DB,
  input: {
    sessionId: string;
    idempotencyKey: string;
    operation: MockRehearsalOperation;
    requestFingerprint: string;
  },
): Promise<MockRehearsalReceiptDecision> {
  const receipt = await db
    .select()
    .from(mockRehearsalCommandReceipts)
    .where(
      and(
        eq(mockRehearsalCommandReceipts.bidSessionId, input.sessionId),
        eq(mockRehearsalCommandReceipts.idempotencyKey, input.idempotencyKey),
      ),
    )
    .get();
  if (receipt === undefined) return { kind: 'new' };
  if (
    receipt.operation !== input.operation ||
    receipt.requestFingerprint !== input.requestFingerprint
  ) {
    return { kind: 'conflict' };
  }
  if (
    receipt.state !== 'completed' ||
    receipt.responseStatus === null ||
    receipt.responseJson === null
  ) {
    return { kind: 'outcome_unknown' };
  }
  try {
    JSON.parse(receipt.responseJson);
  } catch {
    return { kind: 'outcome_unknown' };
  }
  return { kind: 'replay', response: replayResponse(receipt.responseJson, receipt.responseStatus) };
}

async function reserveMockRehearsalReceipt(
  db: DB,
  input: {
    sessionId: string;
    idempotencyKey: string;
    operation: MockRehearsalOperation;
    actorSubject: string;
    requestFingerprint: string;
    expectedMockControlRevision: number;
  },
): Promise<void> {
  await db.insert(mockRehearsalCommandReceipts).values({
    bidSessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    actorSubject: input.actorSubject,
    requestFingerprint: input.requestFingerprint,
    expectedMockControlRevision: input.expectedMockControlRevision,
    state: 'pending',
    createdAt: new Date(),
  });
}

async function completeMockRehearsalReceipt(
  db: DB,
  input: {
    sessionId: string;
    idempotencyKey: string;
    responseStatus: number;
    responseBody: unknown;
    expectedMockControlRevision: number;
  },
): Promise<void> {
  const completed = await db
    .update(mockRehearsalCommandReceipts)
    .set({
      state: 'completed',
      responseStatus: input.responseStatus,
      responseJson: JSON.stringify(input.responseBody),
      resultingMockControlRevision: input.expectedMockControlRevision + 1,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(mockRehearsalCommandReceipts.bidSessionId, input.sessionId),
        eq(mockRehearsalCommandReceipts.idempotencyKey, input.idempotencyKey),
        eq(mockRehearsalCommandReceipts.state, 'pending'),
      ),
    )
    .returning({ idempotencyKey: mockRehearsalCommandReceipts.idempotencyKey })
    .get();
  if (completed === undefined) {
    throw new Error('mock rehearsal receipt completion outcome is unknown');
  }
}

function mockRehearsalReceiptFailure(c: {
  json: (body: Record<string, unknown>, status: 409) => Response;
}, decision: Exclude<MockRehearsalReceiptDecision, { readonly kind: 'new' | 'replay' }>) {
  return c.json(
    {
      error:
        decision.kind === 'conflict'
          ? 'rehearsal_idempotency_key_reused'
          : 'rehearsal_command_outcome_unknown',
    },
    409,
  );
}

/**
 * Once a canonical command has created state for a session, direct rehearsal
 * writes are no longer authoritative. They must be expressed as an audited,
 * sequenced canonical command instead of mutating legacy tables alongside it.
 */
async function hasCanonicalSessionState(db: DB, sessionId: string): Promise<boolean> {
  return (
    (await db
      .select({ bidSessionId: canonicalBidSessionState.bidSessionId })
      .from(canonicalBidSessionState)
      .where(eq(canonicalBidSessionState.bidSessionId, sessionId))
      .get()) !== undefined
  );
}

/**
 * Task R5 — POST /api/admin/rehearsal/:sessionId/auto-bid
 *
 * Body: { count, strategy }
 *   count    1..200 picks to attempt
 *   strategy 'first_eligible'
 *
 * Loops up to `count` picks, finding the current bidder via the DO snapshot
 * (falls back to `bid_sessions.current_bidder_id`), evaluating eligibility
 * against the active rule book, and inserting a proxy bid row + audit entry.
 *
 * Stops early when:
 *   - session reaches `complete` phase
 *   - the same eligibility check fails for 5 consecutive members (no_eligible)
 *   - count is reached
 *
 * Returns 200 with `{ picksMade, stoppedReason, detail? }`.
 * Returns 207 multi-status when picks were made but the loop hit no_eligible.
 * Returns 403 if the session is not marked mock.
 */
router.post(
  '/:sessionId/auto-bid',
  requireStepUpAuth(),
  zValidator('json', AutoBidBodySchema),
  async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const idempotencyKey = RehearsalIdempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'));
  if (!idempotencyKey.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const claims = c.get('claims');
  const actorSubject = String(claims.sub);
  const requestFingerprint = rehearsalCommandFingerprint(
    'auto_bid',
    sessionId,
    actorSubject,
    body.expected_mock_control_revision,
    { count: body.count, strategy: body.strategy },
  );
  try {
    const priorReceipt = await inspectMockRehearsalReceipt(db, {
      sessionId,
      idempotencyKey: idempotencyKey.data,
      operation: 'auto_bid',
      requestFingerprint,
    });
    if (priorReceipt.kind === 'replay') return priorReceipt.response;
    if (priorReceipt.kind !== 'new') return mockRehearsalReceiptFailure(c, priorReceipt);

    let session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (!session.isMock) {
      return c.json({ error: 'not_a_mock_session' }, 403);
    }
    if (await hasCanonicalSessionState(db, sessionId)) {
      return c.json(
        {
          error: 'canonical_mutation_requires_command',
          detail:
            'This mock session is controlled by canonical commands; create a new mock session instead.',
        },
        409,
      );
    }
    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      const insideReceipt = await inspectMockRehearsalReceipt(db, {
        sessionId,
        idempotencyKey: idempotencyKey.data,
        operation: 'auto_bid',
        requestFingerprint,
      });
      if (insideReceipt.kind === 'replay') return insideReceipt.response;
      if (insideReceipt.kind !== 'new') return mockRehearsalReceiptFailure(c, insideReceipt);

      session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
      if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (!session.isMock) return c.json({ error: 'not_a_mock_session' }, 403);
      if (await hasCanonicalSessionState(db, sessionId)) {
        return c.json(
          {
            error: 'canonical_mutation_requires_command',
            detail:
              'This mock session is controlled by canonical commands; create a new mock session instead.',
          },
          409,
        );
      }
      if (session.mockControlRevision !== body.expected_mock_control_revision) {
        return c.json(
          {
            error: 'stale_mock_control_revision',
            expected_mock_control_revision: body.expected_mock_control_revision,
            current_mock_control_revision: session.mockControlRevision,
          },
          409,
        );
      }
      if (session.currentPhase === 'complete') {
        return c.json({ picksMade: 0, stoppedReason: 'complete' });
      }

      const frozenPolicy = await loadFrozenSessionBidPolicy(db, sessionId);
      if (!frozenPolicy.ok) {
        return c.json(
          {
            error: 'session_policy_snapshot_unavailable',
            policy_error: frozenPolicy.code,
            position_ids: 'positionIds' in frozenPolicy ? (frozenPolicy.positionIds ?? []) : [],
          },
          409,
        );
      }
      const { rules } = frozenPolicy.coverage;
      const rulesByPosition = new Map(rules.map((r) => [r.positionId, r]));

      let orderRows = await db
        .select()
        .from(bidOrder)
        .where(eq(bidOrder.bidSessionId, sessionId))
        .orderBy(asc(bidOrder.ordinal))
        .all();
      const expectedOrder = computeBidOrder(bidOrderInputFromSnapshot(frozenPolicy.snapshot));
      if (expectedOrder.length === 0) {
        return c.json({ picksMade: 0, stoppedReason: 'error', detail: 'no_members_to_bid' }, 200);
      }
      // A legacy mock may predate the frozen policy boundary. Never reuse an
      // order that could contain an administratively assigned Division Chief or
      // a mutable-roster member. A fresh mock starts empty and is bootstrapped
      // below; an old inconsistent mock is safely blocked for operator review.
      if (orderRows.length > 0 && !orderMatchesFrozenSnapshot(orderRows, expectedOrder)) {
        return c.json({ error: 'bid_order_not_frozen_policy' }, 409);
      }

      await reserveMockRehearsalReceipt(db, {
        sessionId,
        idempotencyKey: idempotencyKey.data,
        operation: 'auto_bid',
        actorSubject,
        requestFingerprint,
        expectedMockControlRevision: body.expected_mock_control_revision,
      });
      const advancedRevision = await db
        .update(bidSessions)
        .set({ mockControlRevision: sql`${bidSessions.mockControlRevision} + 1` })
        .where(
          and(
            eq(bidSessions.id, sessionId),
            eq(bidSessions.isMock, true),
            eq(bidSessions.mockControlRevision, body.expected_mock_control_revision),
          ),
        )
        .returning({ mockControlRevision: bidSessions.mockControlRevision })
        .get();
      // A writer outside the session-scoped lease changed the row after the
      // receipt was reserved. Its outcome cannot be reconstructed safely, so
      // preserve the pending receipt and fail closed instead of double-picking.
      if (advancedRevision === undefined) {
        return c.json({ error: 'rehearsal_command_outcome_unknown' }, 409);
      }
      const finish = async (responseBody: unknown, responseStatus: number) => {
        await completeMockRehearsalReceipt(db, {
          sessionId,
          idempotencyKey: idempotencyKey.data,
          responseStatus,
          responseBody,
          expectedMockControlRevision: body.expected_mock_control_revision,
        });
        return c.json(responseBody, responseStatus as 200 | 207 | 500);
      };

      // Bootstrap: mock sessions created via /admin/sessions/new sit in `config`
      // phase with an empty bid_order until someone manually calls the start
      // endpoint. Rehearsal flow should be one-click — if bid_order is empty
      // here, compute it from the captured session snapshot (the same frozen
      // seniority + pool rules session-start uses), insert it, and advance the
      // session to position_bid
      // with currentBidderId set to ordinal 1. The auto-bid loop then proceeds
      // naturally.
      let bootstrapped = false;
      if (orderRows.length === 0) {
        try {
          // D1 caps bound parameters at ~100 per statement. 226 members × 4 cols =
          // 904 placeholders blows the limit in one INSERT. Chunk to 20 rows
          // (80 placeholders) per statement to stay safely under.
          const BID_ORDER_INSERT_CHUNK = 20;
          const rowsToInsert = expectedOrder.map((e) => ({
            bidSessionId: sessionId,
            ordinal: e.ordinal,
            memberId: e.memberId,
            pool: e.pool,
          }));
          for (let i = 0; i < rowsToInsert.length; i += BID_ORDER_INSERT_CHUNK) {
            const chunk = rowsToInsert.slice(i, i + BID_ORDER_INSERT_CHUNK);
            await db.insert(bidOrder).values(chunk);
          }
          const first = expectedOrder[0];
          const firstMemberId = first ? first.memberId : null;
          await db
            .update(bidSessions)
            .set({
              currentPhase: 'position_bid',
              currentBidderId: firstMemberId,
              startedAt: session.startedAt ?? new Date(),
            })
            .where(eq(bidSessions.id, sessionId));
          orderRows = await db
            .select()
            .from(bidOrder)
            .where(eq(bidOrder.bidSessionId, sessionId))
            .orderBy(asc(bidOrder.ordinal))
            .all();
          bootstrapped = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[rehearsal.auto-bid] bootstrap failed', { sessionId, msg });
          return finish(
            { picksMade: 0, stoppedReason: 'error', detail: `bootstrap_failed: ${msg}` },
            500,
          );
        }
      }
      if (orderRows.length === 0) {
        return finish({ picksMade: 0, stoppedReason: 'error', detail: 'no_bid_order' }, 200);
      }

      // Self-heal: a prior failed bootstrap may have left bid_order rows but
      // never updated current_phase / current_bidder_id. If the session is still
      // in config OR currentBidderId is null, advance it now using the existing
      // ordering — better than telling the chief the session is "complete" with
      // zero picks made.
      if (
        session.currentPhase === 'config' ||
        (session.currentBidderId === null && orderRows.length > 0)
      ) {
        const firstRow = orderRows[0];
        if (firstRow !== undefined) {
          await db
            .update(bidSessions)
            .set({
              currentPhase: 'position_bid',
              currentBidderId: firstRow.memberId,
              startedAt: session.startedAt ?? new Date(),
            })
            .where(eq(bidSessions.id, sessionId));
          session.currentPhase = 'position_bid';
          session.currentBidderId = firstRow.memberId;
          bootstrapped = true;
        }
      }
      const memberIdToNextMember = new Map<number, number | null>();
      for (let i = 0; i < orderRows.length; i++) {
        const cur = orderRows[i];
        const nxt = orderRows[i + 1];
        if (cur !== undefined) {
          memberIdToNextMember.set(cur.memberId, nxt?.memberId ?? null);
        }
      }

      // `bids.admin_actor_id` is FK → members.id with ON DELETE RESTRICT. SQLite
      // enforces the FK on any non-NULL value, so passing 0 (the synthetic
      // "Bid Admin" identity that lives outside the members table) blows the
      // INSERT with a FOREIGN KEY constraint failure mid-loop. NULL bypasses
      // the FK check, which is the intended semantics for "no member row
      // behind this admin action" — same shape the DO uses for its admin
      // actions.
      const adminActorId: number | null = claims.sub > 0 ? claims.sub : null;

      let picksMade = 0;
      let consecutiveNoEligible = 0;
      let stoppedReason: 'count_reached' | 'complete' | 'no_eligible' | 'error' = 'count_reached';
      let detail: string | undefined;
      // If we just bootstrapped, the DO snapshot doesn't have the new ordering
      // yet, so don't ask it — take the first ordinal from the freshly-inserted
      // bid_order rows. Otherwise prefer the DO (it's authoritative once the
      // session is live).
      const firstOrderRow = orderRows[0];
      const firstFromOrder = firstOrderRow !== undefined ? firstOrderRow.memberId : null;
      let currentBidder = bootstrapped ? firstFromOrder : session.currentBidderId ?? null;
      if (bootstrapped) {
        await writeAuditLog(db, {
          bidSessionId: sessionId,
          actorType: 'admin',
          actorId: adminActorId,
          action: 'session_start',
          targetKind: 'bid_session',
          targetId: sessionId,
          reason: 'rehearsal auto-bid bootstrap',
          beforeState: { current_phase: 'config' },
          afterState: { current_phase: 'position_bid', bid_order_rows: orderRows.length },
        });
      }

      for (let i = 0; i < body.count; i++) {
        if (currentBidder === null) {
          stoppedReason = 'complete';
          break;
        }

        const frozenMember = frozenEligibilityMemberForSession(
          frozenPolicy.snapshot,
          currentBidder,
        );
        if (frozenMember === null) {
          stoppedReason = 'error';
          detail = `session policy material missing for member ${currentBidder}`;
          break;
        }
        const member = eligibilityMemberFromFrozen(frozenMember);

        const taken = await db
          .select({ positionId: bids.positionId })
          .from(bids)
          .where(eq(bids.bidSessionId, sessionId))
          .all();
        const takenSet = new Set(taken.map((t) => t.positionId));

        // Deterministic rehearsal behavior: walk eligible rules in declaration order.
        const candidatePositions = rules.map((r) => r.positionId).filter((p) => !takenSet.has(p));

        let chosenPositionId: string | null = null;
        for (const positionId of candidatePositions) {
          const rule = rulesByPosition.get(positionId);
          if (rule === undefined) continue;
          const r = evaluateEligibility(member, rule);
          if (r.eligible) {
            chosenPositionId = positionId;
            break;
          }
        }

        if (chosenPositionId === null) {
          consecutiveNoEligible++;
          if (consecutiveNoEligible >= 5) {
            stoppedReason = 'no_eligible';
            detail = `5 consecutive members with no eligible position starting at member ${currentBidder}`;
            break;
          }
          // Advance to the next member and try again
          currentBidder = memberIdToNextMember.get(currentBidder) ?? null;
          continue;
        }
        consecutiveNoEligible = 0;

        // Insert the bid row (proxy bid by admin). ordinal is best-effort — the
        // DO is the source of truth for the live ordering, but rehearsal mode
        // wires straight to D1 so the dashboard shows progress.
        const bidId = ulid();
        const maxOrdRow = await db
          .select({ m: sql<number | null>`max(${bids.ordinal})` })
          .from(bids)
          .where(eq(bids.bidSessionId, sessionId))
          .get();
        const ordinal = (maxOrdRow?.m ?? 0) + 1;
        const idemKey = `rehearsal-auto:${requestFingerprint}:${i}`;

        await db.insert(bids).values({
          id: bidId,
          bidSessionId: sessionId,
          ordinal,
          memberId: currentBidder,
          positionId: chosenPositionId,
          pickedAt: new Date(),
          forced: false,
          adminActorId,
          reason: `rehearsal auto-bid (${body.strategy})`,
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
          reason: `rehearsal auto-bid (${body.strategy})`,
          afterState: {
            member_id: currentBidder,
            position_id: chosenPositionId,
            strategy: body.strategy,
            rehearsal: true,
          },
        });

        picksMade++;

        // Advance to the next bidder for the next iteration.
        currentBidder = memberIdToNextMember.get(currentBidder) ?? null;
        await db
          .update(bidSessions)
          .set({ currentBidderId: currentBidder })
          .where(eq(bidSessions.id, sessionId));

        if (currentBidder === null) {
          // Roster exhausted — mark complete and stop.
          await db
            .update(bidSessions)
            .set({ currentPhase: 'complete' })
            .where(eq(bidSessions.id, sessionId));
          stoppedReason = 'complete';
          break;
        }

        // Rate limit between picks. Tests pass through (sleep is short).
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }

      const responseBody: {
        picksMade: number;
        stoppedReason: string;
        detail?: string;
        bootstrapped?: boolean;
        mock_control_revision?: number;
      } = {
        picksMade,
        stoppedReason,
      };
      if (detail !== undefined) responseBody.detail = detail;
      if (bootstrapped) responseBody.bootstrapped = true;
      responseBody.mock_control_revision = advancedRevision.mockControlRevision;
      const status = stoppedReason === 'no_eligible' && picksMade > 0 ? 207 : 200;
      return finish(responseBody, status);
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[rehearsal.auto-bid] uncaught', { sessionId, msg, stack });
    return c.json({ picksMade: 0, stoppedReason: 'error', detail: `uncaught: ${msg}` }, 500);
  }
});

// ── Admin manual pick (mock-only, no step-up) ──────────────────────────────

const ManualPickBodySchema = z.object({
  member_id: z.number().int().positive(),
  position_id: z
    .string()
    .trim()
    .regex(/^[A-D]\d{3}$/, 'Position ID format: <shift><3-digits>'),
  /** Force=true bypasses eligibility (admin override). */
  force: z.boolean().optional(),
  /** Optional admin note that surfaces in the audit row. */
  reason: z.string().trim().max(500).optional(),
  expected_mock_control_revision: z.number().int().nonnegative(),
});

/**
 * POST /api/admin/rehearsal/:sessionId/manual-pick
 *
 * Admin manually assigns a member to a position in a MOCK session. Skips
 * step-up auth (rehearsal is low-stakes) and the structured reason_code
 * machinery — just commits the pick straight to D1. Eligibility is enforced
 * by default; pass `force: true` in the body to override.
 *
 * For LIVE bid day, use `/api/admin/bid-session/:id/bid-for-member` instead,
 * which requires step-up + a reason_code.
 *
 * Returns 403 if the session is not flagged is_mock. The rehearsal console
 * is the only legitimate caller.
 */
router.post(
  '/:sessionId/manual-pick',
  requireStepUpAuth(),
  zValidator('json', ManualPickBodySchema),
  async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const idempotencyKey = RehearsalIdempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'));
  if (!idempotencyKey.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const claims = c.get('claims');
  const actorSubject = String(claims.sub);
  const requestFingerprint = rehearsalCommandFingerprint(
    'manual_pick',
    sessionId,
    actorSubject,
    body.expected_mock_control_revision,
    {
      member_id: body.member_id,
      position_id: body.position_id,
      force: body.force === true,
      reason: body.reason ?? null,
    },
  );
  const priorReceipt = await inspectMockRehearsalReceipt(db, {
    sessionId,
    idempotencyKey: idempotencyKey.data,
    operation: 'manual_pick',
    requestFingerprint,
  });
  if (priorReceipt.kind === 'replay') return priorReceipt.response;
  if (priorReceipt.kind !== 'new') return mockRehearsalReceiptFailure(c, priorReceipt);

  let session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (!session.isMock) {
    return c.json(
      {
        error: 'not_mock_session',
        detail:
          'manual-pick is mock-only — use /api/admin/bid-session/:id/bid-for-member for live sessions',
      },
      403,
    );
  }
  if (await hasCanonicalSessionState(db, sessionId)) {
    return c.json(
      {
        error: 'canonical_mutation_requires_command',
        detail:
          'This mock session is controlled by canonical commands; create a new mock session instead.',
      },
      409,
    );
  }
  const frozenPolicy = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozenPolicy.ok) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: frozenPolicy.code,
        position_ids: 'positionIds' in frozenPolicy ? (frozenPolicy.positionIds ?? []) : [],
      },
      409,
    );
  }
  const activeRules = frozenPolicy.coverage;

  const frozenMember = frozenEligibilityMemberForSession(frozenPolicy.snapshot, body.member_id);
  if (frozenMember === null) {
    return c.json({ error: 'session_policy_snapshot_material_missing' }, 409);
  }
  if (frozenMember.pool === 'EXCLUDED') {
    return c.json(
      {
        error: 'member_not_in_bid_pool',
        exclusion_reason: frozenMember.exclusionReason,
      },
      422,
    );
  }

  // Force may bypass an individual eligibility criterion during a rehearsal;
  // it can never turn a non-biddable staffing position into an opportunity.
  const rule = activeRules.rules.find((entry) => entry.positionId === body.position_id);
  if (rule === undefined) {
    return c.json({ error: 'position_not_biddable' }, 422);
  }

  // Eligibility gate — admin can override with force=true.
  if (body.force !== true) {
    const evalResult = evaluateEligibility(eligibilityMemberFromFrozen(frozenMember), rule);
    if (!evalResult.eligible) {
      return c.json({ error: 'ineligible', reasons: evalResult.reasons }, 422);
    }
  }

  const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
    const insideReceipt = await inspectMockRehearsalReceipt(db, {
      sessionId,
      idempotencyKey: idempotencyKey.data,
      operation: 'manual_pick',
      requestFingerprint,
    });
    if (insideReceipt.kind === 'replay') return insideReceipt.response;
    if (insideReceipt.kind !== 'new') return mockRehearsalReceiptFailure(c, insideReceipt);

    session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (!session.isMock) {
      return c.json(
        {
          error: 'not_mock_session',
          detail:
            'manual-pick is mock-only — use /api/admin/bid-session/:id/bid-for-member for live sessions',
        },
        403,
      );
    }
    if (await hasCanonicalSessionState(db, sessionId)) {
      return c.json(
        {
          error: 'canonical_mutation_requires_command',
          detail:
            'This mock session is controlled by canonical commands; create a new mock session instead.',
        },
        409,
      );
    }
    if (session.mockControlRevision !== body.expected_mock_control_revision) {
      return c.json(
        {
          error: 'stale_mock_control_revision',
          expected_mock_control_revision: body.expected_mock_control_revision,
          current_mock_control_revision: session.mockControlRevision,
        },
        409,
      );
    }

    // Refuse if the position is already filled.
    const existingForPosition = await db
      .select({ id: bids.id })
      .from(bids)
      .where(and(eq(bids.bidSessionId, sessionId), eq(bids.positionId, body.position_id)))
      .get();
    if (existingForPosition !== undefined) {
      return c.json({ error: 'position_already_filled', bid_id: existingForPosition.id }, 409);
    }

    await reserveMockRehearsalReceipt(db, {
      sessionId,
      idempotencyKey: idempotencyKey.data,
      operation: 'manual_pick',
      actorSubject,
      requestFingerprint,
      expectedMockControlRevision: body.expected_mock_control_revision,
    });
    const advancedRevision = await db
      .update(bidSessions)
      .set({ mockControlRevision: sql`${bidSessions.mockControlRevision} + 1` })
      .where(
        and(
          eq(bidSessions.id, sessionId),
          eq(bidSessions.isMock, true),
          eq(bidSessions.mockControlRevision, body.expected_mock_control_revision),
        ),
      )
      .returning({ mockControlRevision: bidSessions.mockControlRevision })
      .get();
    if (advancedRevision === undefined) {
      return c.json({ error: 'rehearsal_command_outcome_unknown' }, 409);
    }
    const finish = async (responseBody: unknown, responseStatus: number) => {
      await completeMockRehearsalReceipt(db, {
        sessionId,
        idempotencyKey: idempotencyKey.data,
        responseStatus,
        responseBody,
        expectedMockControlRevision: body.expected_mock_control_revision,
      });
      return c.json(responseBody, responseStatus as 201);
    };

    const adminActorId: number | null = claims.sub > 0 ? claims.sub : null;
    const bidId = ulid();
    const maxOrdRow = await db
      .select({ m: sql<number | null>`max(${bids.ordinal})` })
      .from(bids)
      .where(eq(bids.bidSessionId, sessionId))
      .get();
    const ordinal = (maxOrdRow?.m ?? 0) + 1;
    const idemKey = `rehearsal-manual:${requestFingerprint}`;
    const reason = body.reason ?? 'rehearsal manual pick';

    await db.insert(bids).values({
      id: bidId,
      bidSessionId: sessionId,
      ordinal,
      memberId: body.member_id,
      positionId: body.position_id,
      pickedAt: new Date(),
      forced: body.force === true,
      adminActorId,
      reason,
      idempotencyKey: idemKey,
      portalSyncStatus: 'pending',
      portalSyncAttempts: 0,
    });

    await writeAuditLog(db, {
      bidSessionId: sessionId,
      actorType: 'admin',
      actorId: adminActorId,
      action: body.force === true ? 'forced_pick' : 'admin_bid_for_member',
      targetKind: 'bid',
      targetId: bidId,
      reason,
      afterState: {
        member_id: body.member_id,
        position_id: body.position_id,
        force: body.force === true,
        rehearsal: true,
      },
    });

    // Advance currentBidderId if this picked the current bidder. Best-effort —
    // mirrors what auto-bid does so the UI moves forward.
    if (session.currentBidderId === body.member_id) {
      const orderRow = await db
        .select({ ordinal: bidOrder.ordinal })
        .from(bidOrder)
        .where(and(eq(bidOrder.bidSessionId, sessionId), eq(bidOrder.memberId, body.member_id)))
        .get();
      if (orderRow !== undefined) {
        const nextRow = await db
          .select({ memberId: bidOrder.memberId })
          .from(bidOrder)
          .where(eq(bidOrder.bidSessionId, sessionId))
          .orderBy(asc(bidOrder.ordinal))
          .all();
        const idx = nextRow.findIndex((r) => r.memberId === body.member_id);
        const next =
          idx >= 0 && idx + 1 < nextRow.length ? (nextRow[idx + 1]?.memberId ?? null) : null;
        await db
          .update(bidSessions)
          .set({ currentBidderId: next })
          .where(eq(bidSessions.id, sessionId));
      }
    }

    return finish(
      {
        bid_id: bidId,
        forced: body.force === true,
        mock_control_revision: advancedRevision.mockControlRevision,
      },
      201,
    );
  });
  if (!mutation.ok) return c.json({ error: mutation.error }, 409);
  return mutation.value;
});

// ── Task R6 — Rehearsal findings (in-app bug tracker) ───────────────────────

const PostFindingBodySchema = z.object({
  bidSessionId: z.string().min(1),
  note: z.string().min(1).max(4000),
  screenshotR2Key: z.string().min(1).max(500).optional(),
});

/**
 * POST /api/admin/rehearsal/findings
 *
 * Body: { bidSessionId, note, screenshotR2Key? }
 *
 * Inserts one finding row. Returns 404 if the session doesn't exist, 201 on
 * success with the created row. Admin-only.
 */
router.post('/findings', zValidator('json', PostFindingBodySchema), async (c) => {
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, body.bidSessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);

  const claims = c.get('claims');
  const authorId = claims.sub > 0 ? claims.sub : null;
  const id = ulid();
  const createdAt = new Date();

  await db.insert(rehearsalFindings).values({
    id,
    bidSessionId: body.bidSessionId,
    createdAt,
    authorId,
    note: body.note,
    screenshotR2Key: body.screenshotR2Key ?? null,
  });

  return c.json(
    {
      id,
      bidSessionId: body.bidSessionId,
      createdAt: createdAt.toISOString(),
      authorId,
      note: body.note,
      screenshotR2Key: body.screenshotR2Key ?? null,
    },
    201,
  );
});

/**
 * GET /api/admin/rehearsal/findings?session_id=…&limit=50
 *
 * Returns findings for one session ordered newest-first. Admin-only.
 */
router.get('/findings', async (c) => {
  const sessionId = c.req.query('session_id');
  if (sessionId === undefined || sessionId === '') {
    return c.json({ error: 'session_id_required' }, 400);
  }
  const limitParam = c.req.query('limit');
  const parsedLimit = limitParam !== undefined ? Number.parseInt(limitParam, 10) : 50;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(rehearsalFindings)
    .where(eq(rehearsalFindings.bidSessionId, sessionId))
    .orderBy(desc(rehearsalFindings.createdAt))
    .limit(limit)
    .all();

  return c.json({
    findings: rows.map((r) => ({
      id: r.id,
      bidSessionId: r.bidSessionId,
      createdAt: r.createdAt.toISOString(),
      authorId: r.authorId,
      note: r.note,
      screenshotR2Key: r.screenshotR2Key,
    })),
  });
});

/**
 * GET /api/admin/rehearsal/findings-recent?limit=50
 *
 * Returns the most recent findings across ALL mock sessions, for the
 * rehearsal dashboard. Admin-only.
 */
router.get('/findings-recent', async (c) => {
  const limitParam = c.req.query('limit');
  const parsedLimit = limitParam !== undefined ? Number.parseInt(limitParam, 10) : 50;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(rehearsalFindings)
    .orderBy(desc(rehearsalFindings.createdAt))
    .limit(limit)
    .all();
  return c.json({
    findings: rows.map((r) => ({
      id: r.id,
      bidSessionId: r.bidSessionId,
      createdAt: r.createdAt.toISOString(),
      authorId: r.authorId,
      note: r.note,
      screenshotR2Key: r.screenshotR2Key,
    })),
  });
});

/**
 * GET /api/admin/rehearsal/sessions
 *
 * Returns the list of mock sessions for the rehearsal dashboard, with
 * minimal columns: id, bid_year, current_phase, current_bidder_id and the
 * timestamp of the most recent bid. Admin-only.
 */
router.get('/sessions', async (c) => {
  const db = getDb(c.env.DB);
  const sessions = await db
    .select({
      id: bidSessions.id,
      bidYear: bidSessions.bidYear,
      currentPhase: bidSessions.currentPhase,
      currentBidderId: bidSessions.currentBidderId,
      isMock: bidSessions.isMock,
    })
    .from(bidSessions)
    .where(eq(bidSessions.isMock, true))
    .all();

  let effectiveSessions: typeof sessions;
  try {
    effectiveSessions = await Promise.all(
      sessions.map(async (session) => {
        const canonical = await loadCanonicalBidSessionState(c.env.DB, session.id);
        return canonical === null
          ? session
          : {
              ...session,
              currentPhase: canonical.currentPhase,
              currentBidderId: canonical.currentBidderId,
            };
      }),
    );
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }

  // Last-pick lookup per session (best-effort).
  const lastPicks = new Map<string, string>();
  for (const s of effectiveSessions) {
    const last = await db
      .select({ pickedAt: bids.pickedAt })
      .from(bids)
      .where(eq(bids.bidSessionId, s.id))
      .orderBy(desc(bids.pickedAt))
      .limit(1)
      .get();
    if (last !== undefined) {
      lastPicks.set(s.id, last.pickedAt.toISOString());
    }
  }

  return c.json({
    sessions: effectiveSessions.map((s) => ({
      id: s.id,
      bidYear: s.bidYear,
      currentPhase: s.currentPhase,
      currentBidderId: s.currentBidderId,
      isMock: s.isMock,
      lastPickedAtIso: lastPicks.get(s.id) ?? null,
    })),
  });
});

export default router;
