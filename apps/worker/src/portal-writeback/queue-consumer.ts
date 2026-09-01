// Plan 08 Task 22 — State-machine routing of portal post results.
//
// Inputs: a single QueueMessage + dependency capsule.
//
// Result routing:
//   synced     → mark bid synced, queue row done.
//   permanent  → mark bid failed, queue row failed, no retry.
//   transient  → consult retry policy; either requeue with computed delay or
//                give up (permanent_failure when attempts > 24).

import type { PostResult } from './portal-client.js';
import type { QueueMessage } from './queue-producer.js';
import { nextAttempt } from './retry-policy.js';

export interface ConsumerDeps {
  portalClient: (msg: QueueMessage) => Promise<PostResult>;
  /**
   * Persists a durable, fail-closed receipt before each portal delivery state
   * mutation or external publication attempt. The queue consumer deliberately
   * treats an audit failure as a delivery failure: no portal POST may begin.
   */
  recordAudit: (input: {
    bidSessionId: string;
    action: 'portal_writeback_attempt' | 'portal_writeback_outcome';
    targetKind: 'portal_writeback_queue' | 'bid';
    targetId: string;
    afterState: Record<string, unknown>;
    reason: string;
  }) => Promise<void>;
  markBidSynced: (bidId: string, syncedAt: Date, attempts: number) => Promise<void>;
  markBidFailed: (bidId: string, error: string, attempts: number) => Promise<void>;
  incrementAttempts: (bidId: string, attempts: number) => Promise<void>;
  updateQueueRow: (row: {
    id: string;
    status: 'queued' | 'done' | 'failed' | 'in_flight';
    attempts: number;
    nextAttemptAt: Date | null;
    lastError: string | null;
  }) => Promise<void>;
  requeue: (msg: QueueMessage, delaySeconds: number) => Promise<void>;
}

export interface ConsumerCtx {
  nowMs: number;
}

export async function handleMessage(
  msg: QueueMessage,
  deps: ConsumerDeps,
  ctx: ConsumerCtx,
): Promise<void> {
  await deps.recordAudit({
    bidSessionId: msg.payload.bid_session_id,
    action: 'portal_writeback_attempt',
    targetKind: 'portal_writeback_queue',
    targetId: msg.queueRowId,
    afterState: { status: 'in_flight', attempts: msg.attempts, bid_id: msg.bidId },
    reason: 'Portal writeback delivery attempt is beginning.',
  });
  await deps.updateQueueRow({
    id: msg.queueRowId,
    status: 'in_flight',
    attempts: msg.attempts,
    nextAttemptAt: null,
    lastError: null,
  });
  const result = await deps.portalClient(msg);
  if (result.kind === 'synced') {
    await deps.recordAudit({
      bidSessionId: msg.payload.bid_session_id,
      action: 'portal_writeback_outcome',
      targetKind: 'bid',
      targetId: msg.bidId,
      afterState: {
        portal_sync_status: 'synced',
        portal_sync_attempts: msg.attempts + 1,
        queue_status: 'done',
      },
      reason: 'Portal writeback completed successfully.',
    });
    await deps.markBidSynced(msg.bidId, new Date(ctx.nowMs), msg.attempts + 1);
    await deps.updateQueueRow({
      id: msg.queueRowId,
      status: 'done',
      attempts: msg.attempts + 1,
      nextAttemptAt: null,
      lastError: null,
    });
    return;
  }
  if (result.kind === 'permanent') {
    await deps.recordAudit({
      bidSessionId: msg.payload.bid_session_id,
      action: 'portal_writeback_outcome',
      targetKind: 'bid',
      targetId: msg.bidId,
      afterState: {
        portal_sync_status: 'failed',
        portal_sync_attempts: msg.attempts + 1,
        queue_status: 'failed',
      },
      reason: `Portal writeback failed permanently: ${result.message}`,
    });
    await deps.markBidFailed(msg.bidId, result.message, msg.attempts + 1);
    await deps.updateQueueRow({
      id: msg.queueRowId,
      status: 'failed',
      attempts: msg.attempts + 1,
      nextAttemptAt: null,
      lastError: result.message,
    });
    return;
  }
  // transient
  const decision = nextAttempt({ attempts: msg.attempts + 1, nowMs: ctx.nowMs });
  if (decision.kind === 'permanent_failure') {
    const err = `retry budget exhausted: ${result.message}`;
    await deps.recordAudit({
      bidSessionId: msg.payload.bid_session_id,
      action: 'portal_writeback_outcome',
      targetKind: 'bid',
      targetId: msg.bidId,
      afterState: {
        portal_sync_status: 'failed',
        portal_sync_attempts: msg.attempts + 1,
        queue_status: 'failed',
      },
      reason: err,
    });
    await deps.markBidFailed(msg.bidId, err, msg.attempts + 1);
    await deps.updateQueueRow({
      id: msg.queueRowId,
      status: 'failed',
      attempts: msg.attempts + 1,
      nextAttemptAt: null,
      lastError: err,
    });
    return;
  }
  const delaySec = Math.max(1, Math.ceil((decision.nextAttemptAtMs - ctx.nowMs) / 1000));
  await deps.recordAudit({
    bidSessionId: msg.payload.bid_session_id,
    action: 'portal_writeback_outcome',
    targetKind: 'portal_writeback_queue',
    targetId: msg.queueRowId,
    afterState: {
      portal_sync_attempts: msg.attempts + 1,
      queue_status: 'queued',
      next_attempt_at_ms: decision.nextAttemptAtMs,
    },
    reason: `Portal writeback is retryable: ${result.message}`,
  });
  await deps.incrementAttempts(msg.bidId, msg.attempts + 1);
  await deps.updateQueueRow({
    id: msg.queueRowId,
    status: 'queued',
    attempts: msg.attempts + 1,
    nextAttemptAt: new Date(decision.nextAttemptAtMs),
    lastError: result.message,
  });
  await deps.requeue({ ...msg, attempts: msg.attempts + 1 }, delaySec);
}
