import { PortalPayloadSchema } from '@mbfd/shared';
import { and, eq, lte } from 'drizzle-orm';
import { drainBidAuditOutbox } from './audit/archive-outbox.js';
import { getDb } from './db/index.js';
import { bidSessions, bids, members, portalWritebackQueue } from './db/schema.js';
import { resolvePortalPublicationPolicy } from './portal-writeback/publication-policy.js';
import type { QueueMessage } from './portal-writeback/queue-producer.js';
import { type DueQueueRow, runReconciliation } from './portal-writeback/reconciliation.js';
import type { WorkerEnv } from './types/env.js';

/**
 * Plan 08 Task 25 — daily portal-writeback reconciliation.
 * Re-enqueues queue rows whose `next_attempt_at` is in the past and the
 * status is still `queued`. Also counts failed bids for the admin banner.
 * Called from the `scheduled` handler when event.cron matches the 04:15 UTC
 * pattern. Safe to invoke even without the PORTAL_QUEUE binding (no-op).
 */
export async function handlePortalReconciliation(env: WorkerEnv): Promise<void> {
  const policy = resolvePortalPublicationPolicy(env);
  if (!policy.enabled) {
    console.info(`[portal-reconciliation] publication blocked: ${policy.reason}`);
    return;
  }
  if (!env.PORTAL_QUEUE || typeof env.PORTAL_QUEUE.send !== 'function') return;
  const db = getDb(env.DB);
  const queue = env.PORTAL_QUEUE;
  const nowMs = Date.now();
  const result = await runReconciliation({
    nowMs,
    async listDueQueueRows(): Promise<DueQueueRow[]> {
      const rows = await db
        .select()
        .from(portalWritebackQueue)
        .where(
          and(
            eq(portalWritebackQueue.status, 'queued'),
            lte(portalWritebackQueue.nextAttemptAt, new Date(nowMs)),
          ),
        )
        .all();
      return rows.map((r) => ({
        id: r.id,
        payloadJson: r.payloadJson,
        attempts: r.attempts,
        bidId: r.bidId,
      }));
    },
    async listFailedBids() {
      const rows = await db
        .select({ id: bids.id })
        .from(bids)
        .where(eq(bids.portalSyncStatus, 'failed'))
        .all();
      return rows;
    },
    async reEnqueue(row) {
      // W38 — Look up the employeeId via the bids → members FK rather than
      // parsing it out of the idempotency_key. The earlier approach split
      // `idempotency_key` on `_` and took the trailing segment, which is
      // fragile for any key shape that doesn't end in the employeeId
      // (admin force-pick / rehearsal auto-bid keys do not).
      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(row.payloadJson);
      } catch {
        console.error(`[portal-reconciliation] invalid JSON for queue row ${row.id}`);
        return false;
      }
      const parsedPayload = PortalPayloadSchema.safeParse(rawPayload);
      if (!parsedPayload.success) {
        console.error(`[portal-reconciliation] invalid payload for queue row ${row.id}`);
        return false;
      }
      const bidRow = await db
        .select({
          bidSessionId: bids.bidSessionId,
          memberId: bids.memberId,
          isMock: bidSessions.isMock,
        })
        .from(bids)
        .innerJoin(bidSessions, eq(bids.bidSessionId, bidSessions.id))
        .where(eq(bids.id, row.bidId))
        .get();
      if (
        !bidRow ||
        bidRow.isMock ||
        parsedPayload.data.bid_session_id !== bidRow.bidSessionId ||
        parsedPayload.data.idempotency_key !== row.bidId
      ) {
        console.error(`[portal-reconciliation] unsafe queue row ${row.id}; not re-enqueued`);
        return false;
      }
      const memberRow = await db
        .select({ employeeId: members.employeeId })
        .from(members)
        .where(eq(members.id, bidRow.memberId))
        .get();
      if (!memberRow) return false;
      const message: QueueMessage = {
        bidId: row.bidId,
        employeeId: memberRow.employeeId,
        payload: parsedPayload.data,
        attempts: row.attempts,
        queueRowId: row.id,
      };
      await queue.send(message);
      return true;
    },
  });
  console.info('[portal-reconciliation]', result);
}

/**
 * Repairs canonical command archives left pending by a transient R2 failure
 * or a terminated post-command background task. It deliberately shares the
 * existing daily cron instead of adding a new infrastructure trigger.
 */
export async function handleCanonicalAuditArchive(env: WorkerEnv): Promise<void> {
  if (!env.R2_AUDIT || typeof env.R2_AUDIT.put !== 'function') return;
  const result = await drainBidAuditOutbox({ db: env.DB, r2: env.R2_AUDIT });
  console.info('[canonical-audit-archive]', result);
}
