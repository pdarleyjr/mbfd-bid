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
import { type JwtPayload, MockFreezeCommandSchema, MockFreezeRequestSchema } from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { and, asc, desc, eq, inArray, like, ne, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../../audit/canonical-json.js';
import { loadCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import type { DB } from '../../db/index.js';
import {
  aDayPicks,
  auditLog,
  bidOrder,
  bidSessions,
  bids,
  canonicalBidSessionState,
  mockRehearsalCommandReceipts,
  mockRehearsalCommandRecoveryOutcomes,
  rehearsalFindings,
} from '../../db/schema.js';
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

    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      // The request that created canonical state can win the lease after the
      // optimistic preflight above. Re-read the D1 boundary while holding the
      // same permit used by legacy normal-path writers.
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (!current.isMock) return c.json({ error: 'not_a_mock_session' }, 403);

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
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
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

const CloseMockBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/**
 * POST /api/admin/rehearsal/:sessionId/close-mock
 *
 * Terminates a stale, legacy mock rehearsal without deleting its bids, order,
 * or audit history. Canonical command state is deliberately out of scope: a
 * canonical mock needs its own sequenced close command rather than a legacy
 * table write. This supports the staging maintenance gate without allowing a
 * reset to erase rehearsal evidence.
 */
router.post(
  '/:sessionId/close-mock',
  requireStepUpAuth(),
  zValidator('json', CloseMockBodySchema),
  async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = c.req.valid('json');
    const db = getDb(c.env.DB);
    const before = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (before === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (!before.isMock) return c.json({ error: 'not_a_mock_session' }, 403);
    if (await hasCanonicalSessionState(db, sessionId)) {
      return c.json({ error: 'canonical_mock_close_requires_command' }, 409);
    }
    if (before.currentPhase === 'complete') {
      return c.json({ id: sessionId, state: 'complete', idempotent: true });
    }

    const completedAt = new Date();
    const updated = await db
      .update(bidSessions)
      .set({
        currentPhase: 'complete',
        currentBidderId: null,
        currentTurnStartedAt: null,
        pausedAt: null,
        scheduledResumeAt: null,
        completedAt,
      })
      .where(
        and(
          eq(bidSessions.id, sessionId),
          eq(bidSessions.isMock, true),
          ne(bidSessions.currentPhase, 'complete'),
        ),
      )
      .returning();
    const after = updated[0];
    if (after === undefined) {
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current?.isMock && current.currentPhase === 'complete') {
        return c.json({ id: sessionId, state: 'complete', idempotent: true });
      }
      return c.json({ error: 'mock_session_close_conflict' }, 409);
    }

    const claims = c.get('claims');
    await writeAuditLog(db, {
      bidSessionId: sessionId,
      actorType: 'admin',
      actorId: claims.sub > 0 ? claims.sub : null,
      action: 'mock_session_closed',
      targetKind: 'bid_session',
      targetId: sessionId,
      reason: body.reason,
      beforeState: before,
      afterState: after,
    });
    return c.json({ id: sessionId, state: 'complete', idempotent: false });
  },
);

const AutoBidBodySchema = z.object({
  count: z.number().int().positive().max(200),
  strategy: z.literal('first_eligible'),
  expected_mock_control_revision: z.number().int().nonnegative(),
});

const RehearsalIdempotencyKeySchema = z.string().trim().min(1).max(160);

type MockRehearsalOperation = 'auto_bid' | 'manual_pick';

type MockRehearsalReceiptDecision =
  | { readonly kind: 'new' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'replay'; readonly response: Response }
  | { readonly kind: 'conflict' };

type MockRehearsalReceiptWriteMode = 'new' | 'recover_pending';

type MockRehearsalReceiptIdentity = {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly operation: MockRehearsalOperation;
  readonly actorSubject: string;
  readonly requestFingerprint: string;
  readonly expectedMockControlRevision: number;
};

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
  const recovery = await db
    .select()
    .from(mockRehearsalCommandRecoveryOutcomes)
    .where(
      and(
        eq(mockRehearsalCommandRecoveryOutcomes.bidSessionId, input.sessionId),
        eq(mockRehearsalCommandRecoveryOutcomes.idempotencyKey, input.idempotencyKey),
      ),
    )
    .get();
  if (recovery !== undefined) {
    return {
      kind: 'replay',
      response: replayResponse(recovery.responseJson, recovery.responseStatus),
    };
  }
  if (
    receipt.state !== 'completed' ||
    receipt.responseStatus === null ||
    receipt.responseJson === null
  ) {
    return { kind: 'pending' };
  }
  try {
    JSON.parse(receipt.responseJson);
  } catch {
    return { kind: 'conflict' };
  }
  return { kind: 'replay', response: replayResponse(receipt.responseJson, receipt.responseStatus) };
}

function mockRehearsalReceiptReservationStatement(
  rawDb: D1Database,
  mode: MockRehearsalReceiptWriteMode,
  input: MockRehearsalReceiptIdentity,
  nowMs: number,
): D1PreparedStatement | null {
  if (mode === 'recover_pending') return null;
  return rawDb
    .prepare(
      `INSERT INTO mock_rehearsal_command_receipts
         (bid_session_id, idempotency_key, operation, actor_subject,
          request_fingerprint, expected_mock_control_revision, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      input.sessionId,
      input.idempotencyKey,
      input.operation,
      input.actorSubject,
      input.requestFingerprint,
      input.expectedMockControlRevision,
      nowMs,
    );
}

/**
 * Complete a receipt only after the same D1 batch has advanced the session's
 * mock-control revision. The deliberately invalid ELSE value turns a missed
 * guarded session update into a SQLite CHECK failure, rolling the entire
 * batch back instead of exposing a durable pending receipt.
 */
function mockRehearsalReceiptCompletionStatement(
  rawDb: D1Database,
  input: Pick<
    MockRehearsalReceiptIdentity,
    'sessionId' | 'idempotencyKey' | 'expectedMockControlRevision'
  > & {
    readonly responseStatus: number;
    readonly responseBody: unknown;
    readonly completedAtMs: number;
  },
): D1PreparedStatement {
  return rawDb
    .prepare(
      `UPDATE mock_rehearsal_command_receipts
          SET state = CASE
                WHEN EXISTS (
                  SELECT 1
                    FROM bid_sessions
                   WHERE id = ?
                     AND is_mock = 1
                     AND mock_control_revision = ?
                ) THEN 'completed'
                ELSE 'integrity_failure'
              END,
              response_status = ?,
              response_json = ?,
              resulting_mock_control_revision = ?,
              completed_at = ?
        WHERE bid_session_id = ?
          AND idempotency_key = ?
          AND state = 'pending'`,
    )
    .bind(
      input.sessionId,
      input.expectedMockControlRevision + 1,
      input.responseStatus,
      JSON.stringify(input.responseBody),
      input.expectedMockControlRevision + 1,
      input.completedAtMs,
      input.sessionId,
      input.idempotencyKey,
    );
}

async function completeMockRehearsalReceipt(
  db: DB,
  input: {
    sessionId: string;
    idempotencyKey: string;
    responseStatus: number;
    responseBody: unknown;
    expectedMockControlRevision: number;
    outcome?: 'applied' | 'not_applied' | 'recovery_required';
  },
): Promise<void> {
  const outcome = input.outcome ?? 'applied';
  if (outcome !== 'applied') {
    await db.insert(mockRehearsalCommandRecoveryOutcomes).values({
      bidSessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      outcome,
      responseStatus: input.responseStatus,
      responseJson: JSON.stringify(input.responseBody),
      recoveryReason: 'incomplete_historical_receipt_evidence',
      recoveredBy: 'system_recovery',
      recoveredAt: new Date(),
    });
    return;
  }
  const completed = await db
    .update(mockRehearsalCommandReceipts)
    .set({
      state: 'completed',
      responseStatus: input.responseStatus,
      responseJson: JSON.stringify(input.responseBody),
      resultingMockControlRevision:
        outcome === 'applied' ? input.expectedMockControlRevision + 1 : null,
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

function mockRehearsalReceiptFailure(
  c: {
    json: (body: Record<string, unknown>, status: 409) => Response;
  },
  decision: Extract<MockRehearsalReceiptDecision, { readonly kind: 'conflict' }>,
) {
  return c.json(
    { error: decision.kind === 'conflict' ? 'rehearsal_idempotency_key_reused' : 'unknown' },
    409,
  );
}

type MockRehearsalBidMutation = {
  readonly id: string;
  readonly ordinal: number;
  readonly memberId: number;
  readonly positionId: string;
  readonly forced: boolean;
  readonly adminActorId: number | null;
  readonly reason: string;
  readonly idempotencyKey: string;
};

type MockRehearsalAuditMutation = {
  readonly id: string;
  readonly actorId: number | null;
  readonly action: 'session_start' | 'admin_bid_for_member' | 'forced_pick';
  readonly targetKind: string;
  readonly targetId: string;
  readonly beforeState: unknown | null;
  readonly afterState: unknown | null;
  readonly reason: string | null;
};

function mockRehearsalBidStatement(
  rawDb: D1Database,
  sessionId: string,
  mutation: MockRehearsalBidMutation,
  pickedAtSeconds: number,
): D1PreparedStatement {
  return rawDb
    .prepare(
      `INSERT INTO bids
         (id, bid_session_id, ordinal, member_id, position_id, a_day, picked_at,
          forced, admin_actor_id, reason, idempotency_key, portal_sync_status,
          portal_sync_attempts)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', 0)`,
    )
    .bind(
      mutation.id,
      sessionId,
      mutation.ordinal,
      mutation.memberId,
      mutation.positionId,
      pickedAtSeconds,
      mutation.forced ? 1 : 0,
      mutation.adminActorId,
      mutation.reason,
      mutation.idempotencyKey,
    );
}

function mockRehearsalAuditStatement(
  rawDb: D1Database,
  sessionId: string,
  mutation: MockRehearsalAuditMutation,
  createdAtSeconds: number,
): D1PreparedStatement {
  return rawDb
    .prepare(
      `INSERT INTO audit_log
         (id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id,
          client_meta, created_at)
       SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, 'admin', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?
         FROM audit_log
        WHERE bid_session_id = ?`,
    )
    .bind(
      mutation.id,
      sessionId,
      mutation.actorId,
      mutation.action,
      mutation.targetKind,
      mutation.targetId,
      mutation.beforeState === null ? null : JSON.stringify(mutation.beforeState),
      mutation.afterState === null ? null : JSON.stringify(mutation.afterState),
      mutation.reason,
      createdAtSeconds,
      sessionId,
    );
}

function mockRehearsalSessionAdvanceStatement(
  rawDb: D1Database,
  input: {
    readonly sessionId: string;
    readonly expectedMockControlRevision: number;
    readonly currentPhase: 'config' | 'position_bid' | 'a_day_bid' | 'paused' | 'complete';
    readonly currentBidderId: number | null;
  },
): D1PreparedStatement {
  return rawDb
    .prepare(
      `UPDATE bid_sessions
          SET current_phase = ?,
              current_bidder_id = ?,
              mock_control_revision = mock_control_revision + 1
        WHERE id = ?
          AND is_mock = 1
          AND mock_control_revision = ?
          AND NOT EXISTS (
            SELECT 1
              FROM canonical_bid_session_state
             WHERE bid_session_id = ?
          )`,
    )
    .bind(
      input.currentPhase,
      input.currentBidderId,
      input.sessionId,
      input.expectedMockControlRevision,
      input.sessionId,
    );
}

function mockRehearsalOrderStatements(
  rawDb: D1Database,
  sessionId: string,
  order: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const chunkSize = 20;
  for (let offset = 0; offset < order.length; offset += chunkSize) {
    const chunk = order.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const values = chunk.map(() => '(?, ?, ?, ?)').join(', ');
    const bindings: unknown[] = [];
    for (const entry of chunk) {
      bindings.push(sessionId, entry.ordinal, entry.memberId, entry.pool);
    }
    statements.push(
      rawDb
        .prepare(
          `INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES ${values}`,
        )
        .bind(...bindings),
    );
  }
  return statements;
}

type PendingMockRehearsalRecovery =
  | { readonly kind: 'retry' }
  | {
      readonly kind: 'response';
      readonly status: 200 | 201 | 409;
      readonly body: Record<string, unknown>;
    };

async function hasCompleteMockBidAudit(
  db: DB,
  input: {
    readonly sessionId: string;
    readonly bidIds: readonly string[];
    readonly allowedActions: readonly string[];
  },
): Promise<boolean> {
  if (input.bidIds.length === 0) return false;
  const auditRows = await db
    .select({ targetId: auditLog.targetId, action: auditLog.action })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.bidSessionId, input.sessionId),
        inArray(auditLog.targetId, [...input.bidIds]),
      ),
    )
    .all();
  const expectedBidIds = new Set(input.bidIds);
  const auditedBidIds = new Set(
    auditRows.flatMap((row) =>
      row.targetId !== null &&
      expectedBidIds.has(row.targetId) &&
      input.allowedActions.includes(row.action)
        ? [row.targetId]
        : [],
    ),
  );
  return auditedBidIds.size === expectedBidIds.size;
}

/**
 * Receipts written by the current code path are never externally observable
 * as pending: their reservation, all D1 domain writes, and their completion
 * live in one D1 batch. This recovery exists for an interrupted legacy row
 * (or a deliberately injected failure): it either safely reuses an untouched
 * pending receipt, verifies the complete Bid/revision/audit result from
 * deterministic keys, or terminalizes an inconsistent historical row as
 * recovery_required without guessing that it did not apply.
 */
async function recoverPendingMockAutoReceipt(
  db: DB,
  input: Pick<
    MockRehearsalReceiptIdentity,
    'sessionId' | 'idempotencyKey' | 'expectedMockControlRevision' | 'requestFingerprint'
  >,
): Promise<PendingMockRehearsalRecovery> {
  const session = await db
    .select({ mockControlRevision: bidSessions.mockControlRevision })
    .from(bidSessions)
    .where(eq(bidSessions.id, input.sessionId))
    .get();
  if (session?.mockControlRevision === input.expectedMockControlRevision) return { kind: 'retry' };

  const matchingBids = await db
    .select({ id: bids.id })
    .from(bids)
    .where(
      and(
        eq(bids.bidSessionId, input.sessionId),
        like(bids.idempotencyKey, `rehearsal-auto:${input.requestFingerprint}:%`),
      ),
    )
    .all();
  const recoveredRevision = session?.mockControlRevision ?? null;
  const committed =
    recoveredRevision === input.expectedMockControlRevision + 1 &&
    (await hasCompleteMockBidAudit(db, {
      sessionId: input.sessionId,
      bidIds: matchingBids.map((bid) => bid.id),
      allowedActions: ['admin_bid_for_member'],
    }));
  const body: Record<string, unknown> = committed
    ? {
        picksMade: matchingBids.length,
        stoppedReason: 'recovered_after_interruption',
        detail:
          'The prior mock command committed before its response was durable; the recorded Bid rows are authoritative.',
        mock_control_revision: recoveredRevision,
      }
    : {
        error: 'rehearsal_command_recovery_required',
        detail:
          'The prior mock command lacks a complete, safely reconstructable Bid/revision/audit outcome. No new Bid mutation was applied.',
        expected_mock_control_revision: input.expectedMockControlRevision,
        current_mock_control_revision: recoveredRevision,
      };
  const status: 200 | 409 = committed ? 200 : 409;
  await completeMockRehearsalReceipt(db, {
    sessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey,
    responseStatus: status,
    responseBody: body,
    expectedMockControlRevision: input.expectedMockControlRevision,
    outcome: status === 409 ? 'recovery_required' : 'applied',
  });
  return { kind: 'response', status, body };
}

async function recoverPendingMockManualReceipt(
  db: DB,
  input: Pick<
    MockRehearsalReceiptIdentity,
    'sessionId' | 'idempotencyKey' | 'expectedMockControlRevision' | 'requestFingerprint'
  >,
): Promise<PendingMockRehearsalRecovery> {
  const session = await db
    .select({ mockControlRevision: bidSessions.mockControlRevision })
    .from(bidSessions)
    .where(eq(bidSessions.id, input.sessionId))
    .get();
  if (session?.mockControlRevision === input.expectedMockControlRevision) return { kind: 'retry' };

  const bid = await db
    .select({ id: bids.id, forced: bids.forced })
    .from(bids)
    .where(
      and(
        eq(bids.bidSessionId, input.sessionId),
        eq(bids.idempotencyKey, `rehearsal-manual:${input.requestFingerprint}`),
      ),
    )
    .get();
  const recoveredRevision = session?.mockControlRevision ?? null;
  const committed =
    recoveredRevision === input.expectedMockControlRevision + 1 &&
    bid !== undefined &&
    (await hasCompleteMockBidAudit(db, {
      sessionId: input.sessionId,
      bidIds: [bid.id],
      allowedActions: ['admin_bid_for_member', 'forced_pick'],
    }));
  const body: Record<string, unknown> =
    committed && bid !== undefined
      ? {
          bid_id: bid.id,
          forced: bid.forced,
          mock_control_revision: recoveredRevision,
        }
      : {
          error: 'rehearsal_command_recovery_required',
          detail:
            'The prior mock command lacks a complete, safely reconstructable Bid/revision/audit outcome. No new Bid mutation was applied.',
          expected_mock_control_revision: input.expectedMockControlRevision,
          current_mock_control_revision: recoveredRevision,
        };
  const status: 201 | 409 = committed ? 201 : 409;
  await completeMockRehearsalReceipt(db, {
    sessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey,
    responseStatus: status,
    responseBody: body,
    expectedMockControlRevision: input.expectedMockControlRevision,
    outcome: status === 409 ? 'recovery_required' : 'applied',
  });
  return { kind: 'response', status, body };
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
      if (priorReceipt.kind === 'conflict') return mockRehearsalReceiptFailure(c, priorReceipt);

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
        if (insideReceipt.kind === 'conflict') return mockRehearsalReceiptFailure(c, insideReceipt);

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
          if (insideReceipt.kind === 'pending') {
            const recovery = await recoverPendingMockAutoReceipt(db, {
              sessionId,
              idempotencyKey: idempotencyKey.data,
              expectedMockControlRevision: body.expected_mock_control_revision,
              requestFingerprint,
            });
            if (recovery.kind === 'response') return c.json(recovery.body, recovery.status);
          }
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
        const orderRows = await db
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

        const receiptMode: MockRehearsalReceiptWriteMode =
          insideReceipt.kind === 'pending' ? 'recover_pending' : 'new';
        // Compute the entire mock command from immutable/frozen reads before
        // writing anything. The resulting receipt, bid order, bids, audit
        // rows, revision advance, and receipt completion commit as one native
        // D1 batch below; there is no externally visible partial command.
        const orderForPlan = orderRows.length === 0 ? expectedOrder : orderRows;
        if (orderForPlan.length === 0) {
          return c.json({ picksMade: 0, stoppedReason: 'error', detail: 'no_bid_order' }, 200);
        }
        const bootstrapped =
          orderRows.length === 0 ||
          session.currentPhase === 'config' ||
          session.currentBidderId === null;
        const memberIdToNextMember = new Map<number, number | null>();
        for (let index = 0; index < orderForPlan.length; index++) {
          const current = orderForPlan[index];
          if (current !== undefined) {
            memberIdToNextMember.set(current.memberId, orderForPlan[index + 1]?.memberId ?? null);
          }
        }
        const existingBids = await db
          .select({ positionId: bids.positionId, ordinal: bids.ordinal })
          .from(bids)
          .where(eq(bids.bidSessionId, sessionId))
          .all();
        const takenPositionIds = new Set(existingBids.map((entry) => entry.positionId));
        const maxOrdinal = existingBids.reduce((max, entry) => Math.max(max, entry.ordinal), 0);
        const adminActorId: number | null = claims.sub > 0 ? claims.sub : null;
        let currentBidder = bootstrapped
          ? (orderForPlan[0]?.memberId ?? null)
          : session.currentBidderId;
        let finalPhase: 'config' | 'position_bid' | 'a_day_bid' | 'paused' | 'complete' =
          bootstrapped ? 'position_bid' : session.currentPhase;
        let consecutiveNoEligible = 0;
        let stoppedReason: 'count_reached' | 'complete' | 'no_eligible' | 'error' = 'count_reached';
        let detail: string | undefined;
        const plannedBids: MockRehearsalBidMutation[] = [];
        const plannedAudits: MockRehearsalAuditMutation[] = [];
        if (bootstrapped) {
          plannedAudits.push({
            id: ulid(),
            actorId: adminActorId,
            action: 'session_start',
            targetKind: 'bid_session',
            targetId: sessionId,
            beforeState: { current_phase: session.currentPhase },
            afterState: { current_phase: 'position_bid', bid_order_rows: orderForPlan.length },
            reason: 'rehearsal auto-bid bootstrap',
          });
        }
        for (let index = 0; index < body.count; index++) {
          if (currentBidder === null) {
            stoppedReason = 'complete';
            finalPhase = 'complete';
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
          let chosenPositionId: string | null = null;
          for (const rule of rules) {
            if (takenPositionIds.has(rule.positionId)) continue;
            if (evaluateEligibility(member, rule).eligible) {
              chosenPositionId = rule.positionId;
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
            currentBidder = memberIdToNextMember.get(currentBidder) ?? null;
            continue;
          }
          consecutiveNoEligible = 0;
          const bidId = ulid();
          const reason = `rehearsal auto-bid (${body.strategy})`;
          plannedBids.push({
            id: bidId,
            ordinal: maxOrdinal + plannedBids.length + 1,
            memberId: currentBidder,
            positionId: chosenPositionId,
            forced: false,
            adminActorId,
            reason,
            idempotencyKey: `rehearsal-auto:${requestFingerprint}:${index}`,
          });
          plannedAudits.push({
            id: ulid(),
            actorId: adminActorId,
            action: 'admin_bid_for_member',
            targetKind: 'bid',
            targetId: bidId,
            beforeState: null,
            afterState: {
              member_id: currentBidder,
              position_id: chosenPositionId,
              strategy: body.strategy,
              rehearsal: true,
            },
            reason,
          });
          takenPositionIds.add(chosenPositionId);
          currentBidder = memberIdToNextMember.get(currentBidder) ?? null;
          if (currentBidder === null) {
            stoppedReason = 'complete';
            finalPhase = 'complete';
            break;
          }
        }
        const responseBody: Record<string, unknown> = {
          picksMade: plannedBids.length,
          stoppedReason,
          mock_control_revision: body.expected_mock_control_revision + 1,
          ...(detail === undefined ? {} : { detail }),
          ...(bootstrapped ? { bootstrapped: true } : {}),
        };
        const responseStatus: 200 | 207 =
          stoppedReason === 'no_eligible' && plannedBids.length > 0 ? 207 : 200;
        const identity: MockRehearsalReceiptIdentity = {
          sessionId,
          idempotencyKey: idempotencyKey.data,
          operation: 'auto_bid',
          actorSubject,
          requestFingerprint,
          expectedMockControlRevision: body.expected_mock_control_revision,
        };
        const nowMs = Date.now();
        const statements: D1PreparedStatement[] = [];
        const reservation = mockRehearsalReceiptReservationStatement(
          c.env.DB,
          receiptMode,
          identity,
          nowMs,
        );
        if (reservation !== null) statements.push(reservation);
        if (orderRows.length === 0) {
          statements.push(...mockRehearsalOrderStatements(c.env.DB, sessionId, expectedOrder));
        }
        const nowSeconds = Math.floor(nowMs / 1000);
        statements.push(
          ...plannedBids.map((mutation) =>
            mockRehearsalBidStatement(c.env.DB, sessionId, mutation, nowSeconds),
          ),
          ...plannedAudits.map((mutation) =>
            mockRehearsalAuditStatement(c.env.DB, sessionId, mutation, nowSeconds),
          ),
          mockRehearsalSessionAdvanceStatement(c.env.DB, {
            sessionId,
            expectedMockControlRevision: body.expected_mock_control_revision,
            currentPhase: finalPhase,
            currentBidderId: currentBidder,
          }),
          mockRehearsalReceiptCompletionStatement(c.env.DB, {
            ...identity,
            responseStatus,
            responseBody,
            completedAtMs: nowMs,
          }),
        );
        try {
          await c.env.DB.batch(statements);
        } catch {
          const afterFailure = await inspectMockRehearsalReceipt(db, {
            sessionId,
            idempotencyKey: idempotencyKey.data,
            operation: 'auto_bid',
            requestFingerprint,
          });
          if (afterFailure.kind === 'replay') return afterFailure.response;
          return c.json({ error: 'rehearsal_command_retry_safe' }, 503);
        }
        const completed = await inspectMockRehearsalReceipt(db, {
          sessionId,
          idempotencyKey: idempotencyKey.data,
          operation: 'auto_bid',
          requestFingerprint,
        });
        if (completed.kind !== 'replay') {
          return c.json({ error: 'rehearsal_command_retry_safe' }, 503);
        }
        return c.json(responseBody, responseStatus);
      });
      if (!mutation.ok) return c.json({ error: mutation.error }, 409);
      return mutation.value;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error('[rehearsal.auto-bid] uncaught', { sessionId, msg, stack });
      return c.json({ picksMade: 0, stoppedReason: 'error', detail: `uncaught: ${msg}` }, 500);
    }
  },
);

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
    if (priorReceipt.kind === 'conflict') return mockRehearsalReceiptFailure(c, priorReceipt);

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
      if (insideReceipt.kind === 'conflict') return mockRehearsalReceiptFailure(c, insideReceipt);

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
        if (insideReceipt.kind === 'pending') {
          const recovery = await recoverPendingMockManualReceipt(db, {
            sessionId,
            idempotencyKey: idempotencyKey.data,
            expectedMockControlRevision: body.expected_mock_control_revision,
            requestFingerprint,
          });
          if (recovery.kind === 'response') return c.json(recovery.body, recovery.status);
        }
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

      // Advance currentBidderId if this picked the current bidder. Best-effort —
      // mirrors what auto-bid does so the UI moves forward. This is calculated
      // before the batch and committed with the Bid/audit/receipt instead of
      // being a post-receipt write.
      let nextBidderId = session.currentBidderId;
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
          nextBidderId = next;
        }
      }
      const responseBody = {
        bid_id: bidId,
        forced: body.force === true,
        mock_control_revision: body.expected_mock_control_revision + 1,
      };
      const identity: MockRehearsalReceiptIdentity = {
        sessionId,
        idempotencyKey: idempotencyKey.data,
        operation: 'manual_pick',
        actorSubject,
        requestFingerprint,
        expectedMockControlRevision: body.expected_mock_control_revision,
      };
      const nowMs = Date.now();
      const receiptMode: MockRehearsalReceiptWriteMode =
        insideReceipt.kind === 'pending' ? 'recover_pending' : 'new';
      const statements: D1PreparedStatement[] = [];
      const reservation = mockRehearsalReceiptReservationStatement(
        c.env.DB,
        receiptMode,
        identity,
        nowMs,
      );
      if (reservation !== null) statements.push(reservation);
      statements.push(
        mockRehearsalBidStatement(
          c.env.DB,
          sessionId,
          {
            id: bidId,
            ordinal,
            memberId: body.member_id,
            positionId: body.position_id,
            forced: body.force === true,
            adminActorId,
            reason,
            idempotencyKey: idemKey,
          },
          Math.floor(nowMs / 1000),
        ),
        mockRehearsalAuditStatement(
          c.env.DB,
          sessionId,
          {
            id: ulid(),
            actorId: adminActorId,
            action: body.force === true ? 'forced_pick' : 'admin_bid_for_member',
            targetKind: 'bid',
            targetId: bidId,
            beforeState: null,
            afterState: {
              member_id: body.member_id,
              position_id: body.position_id,
              force: body.force === true,
              rehearsal: true,
            },
            reason,
          },
          Math.floor(nowMs / 1000),
        ),
        mockRehearsalSessionAdvanceStatement(c.env.DB, {
          sessionId,
          expectedMockControlRevision: body.expected_mock_control_revision,
          currentPhase: session.currentPhase,
          currentBidderId: nextBidderId,
        }),
        mockRehearsalReceiptCompletionStatement(c.env.DB, {
          ...identity,
          responseStatus: 201,
          responseBody,
          completedAtMs: nowMs,
        }),
      );
      try {
        await c.env.DB.batch(statements);
      } catch {
        const afterFailure = await inspectMockRehearsalReceipt(db, {
          sessionId,
          idempotencyKey: idempotencyKey.data,
          operation: 'manual_pick',
          requestFingerprint,
        });
        if (afterFailure.kind === 'replay') return afterFailure.response;
        return c.json({ error: 'rehearsal_command_retry_safe' }, 503);
      }
      const completed = await inspectMockRehearsalReceipt(db, {
        sessionId,
        idempotencyKey: idempotencyKey.data,
        operation: 'manual_pick',
        requestFingerprint,
      });
      if (completed.kind !== 'replay')
        return c.json({ error: 'rehearsal_command_retry_safe' }, 503);
      return c.json(responseBody, 201);
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

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
 * minimal columns, including the mock-only control revision that the
 * idempotent auto-bid control must echo, and the timestamp of the most recent
 * bid. Admin-only.
 */
router.get('/sessions', async (c) => {
  const db = getDb(c.env.DB);
  const sessions = await db
    .select({
      id: bidSessions.id,
      bidYear: bidSessions.bidYear,
      currentPhase: bidSessions.currentPhase,
      currentBidderId: bidSessions.currentBidderId,
      mockControlRevision: bidSessions.mockControlRevision,
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
      mockControlRevision: s.mockControlRevision,
      isMock: s.isMock,
      lastPickedAtIso: lastPicks.get(s.id) ?? null,
    })),
  });
});

export default router;
