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
  reEnqueue: (row: DueQueueRow) => Promise<void>;
  nowMs: number;
}

export interface ReconciliationResult {
  reEnqueued: number;
  failedBidCount: number;
  ranAt: number;
}

export async function runReconciliation(deps: ReconciliationDeps): Promise<ReconciliationResult> {
  const due = await deps.listDueQueueRows();
  for (const r of due) {
    try {
      await deps.reEnqueue(r);
    } catch (err) {
      // One stuck row shouldn't block the rest of the batch — log and proceed.
      console.error(`[portal-reconciliation] reEnqueue failed for ${r.id}`, err);
    }
  }
  const failed = await deps.listFailedBids();
  return { reEnqueued: due.length, failedBidCount: failed.length, ranAt: deps.nowMs };
}
