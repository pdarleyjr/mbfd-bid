// Plan 08 Task 22 — Worker `queue` handler. Builds the consumer deps from
// the Worker env and walks a MessageBatch, ack/retry per message outcome.

import type { MessageBatch } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/index.js';
import { bids, portalWritebackQueue } from '../db/schema.js';
import type { WorkerEnv } from '../types/env.js';
import { postBidAssignment } from './portal-client.js';
import { type ConsumerDeps, handleMessage } from './queue-consumer.js';
import type { QueueMessage } from './queue-producer.js';

export function makeConsumerDeps(env: WorkerEnv): ConsumerDeps {
  const db = getDb(env.DB);
  return {
    async portalClient(msg) {
      return postBidAssignment({
        employeeId: msg.employeeId,
        payload: msg.payload,
        portalBaseUrl: env.PORTAL_BASE_URL,
        token: env.PORTAL_BID_WRITER ?? '',
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

export async function handlePortalQueueBatch(batch: MessageBatch, env: WorkerEnv): Promise<void> {
  const deps = makeConsumerDeps(env);
  const nowMs = Date.now();
  for (const message of batch.messages) {
    try {
      await handleMessage(message.body as QueueMessage, deps, { nowMs });
      message.ack();
    } catch (err) {
      console.error('[portal-queue] handleMessage threw — letting CF retry once', err);
      message.retry();
    }
  }
}
