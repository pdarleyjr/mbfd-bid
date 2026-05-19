// Plan 08 Task 21 — Producer side of the portal write-back queue.
//
// Atomic enqueue:
//   1. Insert `portal_writeback_queue` row (status=queued, attempts=0).
//   2. env.PORTAL_QUEUE.send(message)
//
// Order matters: the D1 row goes in FIRST so the daily reconciliation has a
// record even if `queue.send` fails. A failed send leaves the row queued; the
// reconciliation cron will re-emit it on the next pass.

import type { Queue } from '@cloudflare/workers-types';
import type { PortalPayload } from '@mbfd/shared';

export interface QueueRowDraft {
  id: string;
  bidId: string;
  enqueuedAt: Date;
  nextAttemptAt: Date;
  attempts: number;
  status: 'queued';
  payloadJson: string;
  lastError: null;
}

export interface EnqueueArgs {
  bidId: string;
  employeeId: string;
  payload: PortalPayload;
  queue: Queue<unknown>;
  insertQueueRow: (row: QueueRowDraft) => Promise<void>;
  now: () => number;
}

export interface QueueMessage {
  bidId: string;
  employeeId: string;
  payload: PortalPayload;
  attempts: number;
  queueRowId: string;
}

export async function enqueuePortalWriteback(a: EnqueueArgs): Promise<void> {
  const now = a.now();
  const queueRowId = `qrow_${a.bidId}_${now}`;
  const nowDate = new Date(now);
  await a.insertQueueRow({
    id: queueRowId,
    bidId: a.bidId,
    enqueuedAt: nowDate,
    nextAttemptAt: nowDate,
    attempts: 0,
    status: 'queued',
    payloadJson: JSON.stringify(a.payload),
    lastError: null,
  });
  const message: QueueMessage = {
    bidId: a.bidId,
    employeeId: a.employeeId,
    payload: a.payload,
    attempts: 0,
    queueRowId,
  };
  await a.queue.send(message);
}
