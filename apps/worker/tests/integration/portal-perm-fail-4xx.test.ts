// Plan 08 Task 23 — 4xx permanent-failure integration test (unit-level).

import type { PortalPayload } from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';

import type { PostResult } from '../../src/portal-writeback/portal-client.js';
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
  idempotency_key: 'bid_t3',
  is_forced: false,
  admin_actor_employee_id: null,
};

describe('portal writeback — 4xx permanent failure (Plan 08 Task 23)', () => {
  it('400 → bid marked failed immediately; no retries', async () => {
    const status: { value: 'pending' | 'synced' | 'failed' } = { value: 'pending' };
    let attemptsRecorded = 0;
    const requeues: QueueMessage[] = [];
    const result: PostResult = {
      kind: 'permanent',
      statusCode: 400,
      message: '400: invalid employee_id',
    };
    const deps = {
      portalClient: vi.fn(async () => result),
      recordAudit: vi.fn(async () => {}),
      markBidSynced: vi.fn(),
      markBidFailed: vi.fn(async (_id: string, _err: string, attempts: number) => {
        status.value = 'failed';
        attemptsRecorded = attempts;
      }),
      incrementAttempts: vi.fn(),
      updateQueueRow: vi.fn(),
      requeue: vi.fn(async (m: QueueMessage) => {
        requeues.push(m);
      }),
    };
    const msg: QueueMessage = {
      bidId: 'bid_t3',
      employeeId: '14523',
      payload,
      attempts: 0,
      queueRowId: 'qrow_1',
    };
    await handleMessage(msg, deps, { nowMs: 0 });
    expect(status.value).toBe('failed');
    expect(attemptsRecorded).toBe(1);
    expect(requeues.length).toBe(0);
  });
});
