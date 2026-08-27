// Plan 08 Task 22 — Worker `queue` handler. Builds the consumer deps from
// the Worker env and walks a MessageBatch, ack/retry per message outcome.

import type { MessageBatch } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/index.js';
import { bidSessions, bids, members, portalWritebackQueue } from '../db/schema.js';
import type { WorkerEnv } from '../types/env.js';
import { postBidAssignment } from './portal-client.js';
import {
  type PortalPublicationPolicy,
  resolvePortalPublicationPolicy,
} from './publication-policy.js';
import { type ConsumerDeps, handleMessage } from './queue-consumer.js';
import { type QueueMessage, QueueMessageSchema } from './queue-producer.js';

export function makeConsumerDeps(
  env: WorkerEnv,
  policy = resolvePortalPublicationPolicy(env),
): ConsumerDeps {
  const db = getDb(env.DB);
  return {
    async portalClient(msg) {
      return postBidAssignment({
        employeeId: msg.employeeId,
        payload: msg.payload,
        portalBaseUrl: policy.portalBaseUrl ?? '',
        publicationEnabled: policy.enabled,
        token: policy.writerToken ?? '',
        fetchImpl: fetch,
      });
    },
    async markBidSynced(bidId, syncedAt, attempts) {
      await db
        .update(bids)
        .set({
          portalSyncStatus: 'synced',
          portalSyncedAt: syncedAt,
          portalSyncAttempts: attempts,
          portalLastError: null,
        })
        .where(eq(bids.id, bidId));
    },
    async markBidFailed(bidId, error, attempts) {
      await db
        .update(bids)
        .set({
          portalSyncStatus: 'failed',
          portalSyncAttempts: attempts,
          portalLastError: error,
        })
        .where(eq(bids.id, bidId));
    },
    async incrementAttempts(bidId, attempts) {
      await db.update(bids).set({ portalSyncAttempts: attempts }).where(eq(bids.id, bidId));
    },
    async updateQueueRow(row) {
      // `next_attempt_at` is NOT NULL in the schema (Plan 02) — only update it
      // when the row supplies a real date. Otherwise we leave the previous
      // value in place, which is correct for terminal states (done/failed)
      // because nobody reads it once the row is terminal.
      const set: Record<string, unknown> = {
        status: row.status,
        attempts: row.attempts,
        lastError: row.lastError,
      };
      if (row.nextAttemptAt !== null) {
        set.nextAttemptAt = row.nextAttemptAt;
      }
      await db.update(portalWritebackQueue).set(set).where(eq(portalWritebackQueue.id, row.id));
    },
    async requeue(msg, delaySeconds) {
      await env.PORTAL_QUEUE.send(msg, { delaySeconds });
    },
  };
}

/**
 * Plan 09 / Rehearsal Tooling — Task R8.
 *
 * Returns true if the message's bid belongs to a session marked `is_mock=1`.
 * Mock sessions are rehearsals; their bids MUST NOT be POSTed to the live HR
 * portal. The consumer acks these without invoking the portal client.
 *
 * Lookup is best-effort: if the bid row is missing (e.g. it was wiped by a
 * reset-mock), we treat the message as a mock so it gets acked rather than
 * looping forever.
 */
type PortalBidLookup =
  | { kind: 'mock' }
  | { kind: 'live'; bidSessionId: string; employeeId: string }
  | { kind: 'missing' }
  | { kind: 'unknown' };

async function lookupPortalBid(env: WorkerEnv, bidId: string): Promise<PortalBidLookup> {
  try {
    const db = getDb(env.DB);
    const row = await db
      .select({
        isMock: bidSessions.isMock,
        bidSessionId: bids.bidSessionId,
        employeeId: members.employeeId,
      })
      .from(bids)
      .innerJoin(bidSessions, eq(bids.bidSessionId, bidSessions.id))
      .innerJoin(members, eq(bids.memberId, members.id))
      .where(eq(bids.id, bidId))
      .get();
    if (row === undefined) {
      // Bid vanished — acknowledge without posting so it cannot be retried
      // into an unrelated future session.
      console.warn(`[portal-writeback] bid ${bidId} not found; acking as mock`);
      return { kind: 'missing' };
    }
    if (row.isMock) return { kind: 'mock' };
    return { kind: 'live', bidSessionId: row.bidSessionId, employeeId: row.employeeId };
  } catch (err) {
    console.error('[portal-writeback] bid lookup failed', err);
    return { kind: 'unknown' };
  }
}

export async function handlePortalQueueBatch(batch: MessageBatch, env: WorkerEnv): Promise<void> {
  const policy = resolvePortalPublicationPolicy(env);
  if (!policy.enabled) {
    console.warn(`[portal-writeback] publication blocked: ${policy.reason}`);
    for (const message of batch.messages) message.ack();
    return;
  }

  const deps = makeConsumerDeps(env, policy);
  const nowMs = Date.now();
  for (const message of batch.messages) {
    const parsed = QueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      console.error('[portal-writeback] invalid queue message; retrying without publication');
      message.retry();
      continue;
    }
    const body: QueueMessage = parsed.data;
    // Plan 09 / Rehearsal Tooling — Task R8.
    // Skip mock-session bids: ack the message without posting to the live
    // portal. This is the second line of defence — the producer should
    // also avoid enqueuing mock bids in the first place, but the consumer
    // double-checks because old in-flight messages can predate mark-mock.
    const bidLookup = await lookupPortalBid(env, body.bidId);
    if (bidLookup.kind === 'mock' || bidLookup.kind === 'missing') {
      console.info(
        `[portal-writeback] skipping mock session ${body.payload.bid_session_id} bid ${body.bidId}`,
      );
      message.ack();
      continue;
    }
    if (bidLookup.kind === 'unknown') {
      // A failed lookup must never be interpreted as a live session. Retry so
      // the message is quarantined/retried by Queue policy without an HTTP POST.
      message.retry();
      continue;
    }
    if (
      body.payload.bid_session_id !== bidLookup.bidSessionId ||
      body.payload.idempotency_key !== body.bidId ||
      body.employeeId !== bidLookup.employeeId
    ) {
      console.error(`[portal-writeback] queue payload identity mismatch for bid ${body.bidId}`);
      message.retry();
      continue;
    }
    try {
      await handleMessage(body, deps, { nowMs });
      message.ack();
    } catch (err) {
      console.error('[portal-queue] handleMessage threw — letting CF retry once', err);
      message.retry();
    }
  }
}
