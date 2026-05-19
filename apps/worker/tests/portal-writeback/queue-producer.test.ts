import type { Queue } from '@cloudflare/workers-types';
import type { PortalPayload } from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';

import { enqueuePortalWriteback } from '../../src/portal-writeback/queue-producer.js';

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

describe('enqueuePortalWriteback (Plan 08 Task 21)', () => {
  it('inserts a queue row first, then sends to the Cloudflare Queue', async () => {
    const send = vi.fn(async () => {});
    const insertQueueRow = vi.fn(async () => {});
    await enqueuePortalWriteback({
      bidId: 'bid_1',
      employeeId: '14523',
      payload,
      queue: { send } as unknown as Queue<unknown>,
      insertQueueRow,
      now: () => 1_000_000,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(insertQueueRow).toHaveBeenCalledWith(
      expect.objectContaining({ bidId: 'bid_1', status: 'queued', attempts: 0 }),
    );
  });

  it('row goes in BEFORE the queue send (so failed sends leave a recoverable row)', async () => {
    const calls: string[] = [];
    const send = vi.fn(async () => {
      calls.push('send');
      throw new Error('queue down');
    });
    const insertQueueRow = vi.fn(async () => {
      calls.push('insert');
    });
    await expect(
      enqueuePortalWriteback({
        bidId: 'bid_1',
        employeeId: '14523',
        payload,
        queue: { send } as unknown as Queue<unknown>,
        insertQueueRow,
        now: () => 0,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual(['insert', 'send']);
  });
});
