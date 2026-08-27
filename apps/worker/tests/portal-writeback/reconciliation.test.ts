import { describe, expect, it, vi } from 'vitest';

import { runReconciliation } from '../../src/portal-writeback/reconciliation.js';

describe('runReconciliation (Plan 08 Task 25)', () => {
  it('re-enqueues every due queue row', async () => {
    const reEnqueue = vi.fn(async () => true);
    const dueRows = [
      { id: 'q1', payloadJson: '{}', attempts: 3, bidId: 'b1' },
      { id: 'q2', payloadJson: '{}', attempts: 1, bidId: 'b2' },
    ];
    const out = await runReconciliation({
      listDueQueueRows: async () => dueRows,
      listFailedBids: async () => [],
      reEnqueue,
      nowMs: 1_700_000_000,
    });
    expect(reEnqueue).toHaveBeenCalledTimes(2);
    expect(out.reEnqueued).toBe(2);
    expect(out.failedBidCount).toBe(0);
    expect(out.ranAt).toBe(1_700_000_000);
  });

  it('reports failed bid count without re-enqueueing them', async () => {
    const reEnqueue = vi.fn(async () => true);
    const out = await runReconciliation({
      listDueQueueRows: async () => [],
      listFailedBids: async () => [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
      reEnqueue,
      nowMs: 0,
    });
    expect(out.failedBidCount).toBe(3);
    expect(reEnqueue).toHaveBeenCalledTimes(0);
  });

  it('continues past a single re-enqueue failure', async () => {
    let calls = 0;
    const reEnqueue = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('queue down');
      return true;
    });
    const out = await runReconciliation({
      listDueQueueRows: async () => [
        { id: 'q1', payloadJson: '{}', attempts: 1, bidId: 'b1' },
        { id: 'q2', payloadJson: '{}', attempts: 1, bidId: 'b2' },
      ],
      listFailedBids: async () => [],
      reEnqueue,
      nowMs: 0,
    });
    expect(reEnqueue).toHaveBeenCalledTimes(2);
    expect(out.reEnqueued).toBe(1);
  });

  it('does not count a queue row that was safely skipped', async () => {
    const out = await runReconciliation({
      listDueQueueRows: async () => [{ id: 'q1', payloadJson: '{}', attempts: 1, bidId: 'b1' }],
      listFailedBids: async () => [],
      reEnqueue: async () => false,
      nowMs: 0,
    });

    expect(out.reEnqueued).toBe(0);
  });
});
