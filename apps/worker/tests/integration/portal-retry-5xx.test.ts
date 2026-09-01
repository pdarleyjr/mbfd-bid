// Plan 08 Task 23 — 5xx retry-path integration test (unit-level).
//
// Drives the queue consumer state machine through a sequence of mocked
// portal responses and asserts the final terminal state. The full
// `unstable_dev`-based variant in the plan body requires the test-only
// `/test/portal-mock` routes that Plan 09 will add at deploy time; for
// this PR we exercise the same code path via direct invocation.

import type { PortalPayload } from '@mbfd/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  idempotency_key: 'bid_t1',
  is_forced: false,
  admin_actor_employee_id: null,
};

type BidStatus = 'pending' | 'synced' | 'failed' | 'superseded';

interface BidStore {
  status: BidStatus;
  attempts: number;
  lastError: string | null;
}

function makeWorld() {
  const bidsStore = new Map<string, BidStore>();
  bidsStore.set('bid_t1', { status: 'pending', attempts: 0, lastError: null });
  const requeued: QueueMessage[] = [];
  let nextResult: PostResult = { kind: 'transient', statusCode: 503, message: 'down' };

  const deps = {
    portalClient: vi.fn(async () => nextResult),
    recordAudit: vi.fn(async () => {}),
    markBidSynced: vi.fn(async (bidId: string, _syncedAt: Date, attempts: number) => {
      bidsStore.set(bidId, { status: 'synced', attempts, lastError: null });
    }),
    markBidFailed: vi.fn(async (bidId: string, err: string, attempts: number) => {
      bidsStore.set(bidId, { status: 'failed', attempts, lastError: err });
    }),
    incrementAttempts: vi.fn(async (bidId: string, attempts: number) => {
      const cur = bidsStore.get(bidId);
      if (cur) bidsStore.set(bidId, { ...cur, attempts });
    }),
    updateQueueRow: vi.fn(async () => {}),
    requeue: vi.fn(async (msg: QueueMessage) => {
      requeued.push(msg);
    }),
  };
  return {
    deps,
    bidsStore,
    requeued,
    setNext(r: PostResult) {
      nextResult = r;
    },
  };
}

describe('portal writeback — 5xx retry path (Plan 08 Task 23)', () => {
  it('5xx for 3 attempts then 200 → bid ends up synced', async () => {
    const w = makeWorld();
    let msg: QueueMessage = {
      bidId: 'bid_t1',
      employeeId: '14523',
      payload,
      attempts: 0,
      queueRowId: 'qrow_1',
    };
    // 3 transient failures
    for (let i = 0; i < 3; i++) {
      w.setNext({ kind: 'transient', statusCode: 503, message: 'down' });
      await handleMessage(msg, w.deps, { nowMs: i * 1000 });
      const requeued = w.requeued.shift();
      expect(requeued).toBeDefined();
      msg = requeued as QueueMessage;
    }
    // Then success
    w.setNext({ kind: 'synced', statusCode: 200 });
    await handleMessage(msg, w.deps, { nowMs: 10_000 });
    expect(w.bidsStore.get('bid_t1')?.status).toBe('synced');
    expect(w.bidsStore.get('bid_t1')?.attempts).toBeGreaterThanOrEqual(4);
  });

  it('5xx for > 24 attempts → bid ends up failed', async () => {
    const w = makeWorld();
    w.setNext({ kind: 'transient', statusCode: 503, message: 'persistent outage' });
    // Skip ahead to attempts=25 to exercise the retry-budget exhaustion branch.
    const msg: QueueMessage = {
      bidId: 'bid_t1',
      employeeId: '14523',
      payload,
      attempts: 25,
      queueRowId: 'qrow_1',
    };
    await handleMessage(msg, w.deps, { nowMs: 0 });
    expect(w.bidsStore.get('bid_t1')?.status).toBe('failed');
    expect(w.requeued.length).toBe(0);
  });
});
