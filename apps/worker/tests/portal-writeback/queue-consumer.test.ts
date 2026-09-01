import type { PortalPayload } from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';

import { handleMessage } from '../../src/portal-writeback/queue-consumer.js';
import type { QueueMessage } from '../../src/portal-writeback/queue-producer.js';

const payload: PortalPayload = {
  bid_year: 2026,
  bid_session_id: '01HF3',
  rank_label: 'Lieutenant',
  station_label: 'Station 1',
  shift_label: 'A Shift',
  unit_label: 'Rescue 1',
  a_day_label: 'Pending Phase 2',
  position_id: 'A109',
  picked_at: '2026-09-22T14:23:00Z',
  idempotency_key: 'bid_1',
  is_forced: false,
  admin_actor_employee_id: null,
};

const baseMsg: QueueMessage = {
  bidId: 'bid_1',
  employeeId: '14523',
  queueRowId: 'qrow_1',
  attempts: 0,
  payload,
};

function fakeDeps(post: 'synced' | 'transient' | 'permanent') {
  const portalClient = vi.fn(async () => {
    if (post === 'synced') return { kind: 'synced', statusCode: 200 } as const;
    if (post === 'transient')
      return { kind: 'transient', statusCode: 503, message: 'down' } as const;
    return { kind: 'permanent', statusCode: 400, message: 'bad' } as const;
  });
  return {
    portalClient,
    recordAudit: vi.fn(async () => {}),
    markBidSynced: vi.fn(async () => {}),
    markBidFailed: vi.fn(async () => {}),
    incrementAttempts: vi.fn(async () => {}),
    updateQueueRow: vi.fn(async () => {}),
    requeue: vi.fn(async () => {}),
  };
}

describe('handleMessage (Plan 08 Task 22)', () => {
  it('on synced: mark bid synced + queue row done', async () => {
    const d = fakeDeps('synced');
    await handleMessage(baseMsg, d, { nowMs: 0 });
    expect(d.markBidSynced).toHaveBeenCalledTimes(1);
    expect(d.updateQueueRow).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('on transient with attempts < 24: requeues with delay', async () => {
    const d = fakeDeps('transient');
    await handleMessage(baseMsg, d, { nowMs: 0 });
    expect(d.requeue).toHaveBeenCalledTimes(1);
    expect(d.incrementAttempts).toHaveBeenCalled();
  });

  it('on transient with attempts > 24: mark permanently failed', async () => {
    const d = fakeDeps('transient');
    await handleMessage({ ...baseMsg, attempts: 25 }, d, { nowMs: 0 });
    expect(d.markBidFailed).toHaveBeenCalledTimes(1);
    expect(d.requeue).not.toHaveBeenCalled();
  });

  it('on permanent (4xx): mark bid failed immediately, no retry', async () => {
    const d = fakeDeps('permanent');
    await handleMessage(baseMsg, d, { nowMs: 0 });
    expect(d.markBidFailed).toHaveBeenCalledTimes(1);
    expect(d.updateQueueRow).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(d.requeue).not.toHaveBeenCalled();
  });

  it('marks queue row in_flight first, then advances state', async () => {
    const d = fakeDeps('synced');
    await handleMessage(baseMsg, d, { nowMs: 0 });
    const calls = d.updateQueueRow.mock.calls as unknown as Array<[{ status: string }]>;
    expect(calls[0]?.[0].status).toBe('in_flight');
    expect(calls[calls.length - 1]?.[0].status).toBe('done');
  });

  it('does not start portal publication when the pre-write audit receipt fails', async () => {
    const d = fakeDeps('synced');
    d.recordAudit.mockRejectedValueOnce(new Error('injected audit persistence failure'));

    await expect(handleMessage(baseMsg, d, { nowMs: 0 })).rejects.toThrow(
      'injected audit persistence failure',
    );
    expect(d.portalClient).not.toHaveBeenCalled();
    expect(d.updateQueueRow).not.toHaveBeenCalled();
    expect(d.markBidSynced).not.toHaveBeenCalled();
  });
});
