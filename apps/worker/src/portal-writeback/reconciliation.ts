// Plan 08 Task 25 — Daily reconciliation for stuck portal write-backs.
//
// Runs at 04:15 UTC. Two responsibilities:
//   1. Re-enqueue any queue rows whose `next_attempt_at < now` and
//      `status = 'queued'` — Cloudflare Queues occasionally drops delayed
//      messages and the row is the source of truth.
//   2. Count failed bids so the admin banner has an accurate metric.

export interface DueQueueRow {
  id: string;
  payloadJson: string;
  attempts: number;
  bidId: string;
}

export interface ReconciliationDeps {
  listDueQueueRows: () => Promise<DueQueueRow[]>;
  listFailedBids: () => Promise<Array<{ id: string }>>;
  /** True only when the row was actually sent to the Queue. */
  reEnqueue: (row: DueQueueRow) => Promise<boolean>;
  nowMs: number;
}

export interface ReconciliationResult {
  reEnqueued: number;
  failedBidCount: number;
  ranAt: number;
}

export async function runReconciliation(deps: ReconciliationDeps): Promise<ReconciliationResult> {
  const due = await deps.listDueQueueRows();
  let reEnqueued = 0;
  for (const r of due) {
    try {
      if (await deps.reEnqueue(r)) reEnqueued += 1;
    } catch (err) {
      // One stuck row shouldn't block the rest of the batch — log and proceed.
      console.error('[portal-reconciliation] reEnqueue failed', { id: r.id, error: err });
    }
  }
  const failed = await deps.listFailedBids();
  return { reEnqueued, failedBidCount: failed.length, ranAt: deps.nowMs };
}
