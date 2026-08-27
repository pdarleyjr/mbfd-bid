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
import { type PortalPayload, PortalPayloadSchema } from '@mbfd/shared';
import { z } from 'zod';

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
  /** Must come from the centralized fail-closed publication policy. */
  publicationEnabled: boolean;
  /** Mock/rehearsal sessions must never create a portal outbox record. */
  isMock: boolean;
  queue: Queue<unknown>;
  insertQueueRow: (row: QueueRowDraft) => Promise<void>;
  now: () => number;
}

export const QueueMessageSchema = z.object({
  bidId: z.string().min(1),
  employeeId: z.string().min(1),
  payload: PortalPayloadSchema,
  attempts: z.number().int().nonnegative(),
  queueRowId: z.string().min(1),
});

export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export async function enqueuePortalWriteback(a: EnqueueArgs): Promise<boolean> {
  if (!a.publicationEnabled || a.isMock) return false;
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
  return true;
}
