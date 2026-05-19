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
  await deps.updateQueueRow({
    id: msg.queueRowId,
    status: 'in_flight',
    attempts: msg.attempts,
    nextAttemptAt: null,
    lastError: null,
  });
  const result = await deps.portalClient(msg);
  if (result.kind === 'synced') {
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
