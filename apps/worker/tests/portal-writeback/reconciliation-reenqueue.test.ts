// W38 — handlePortalReconciliation's reEnqueue function uses the bids →
// members FK to resolve employeeId, not the idempotency_key string. This
// test verifies the new path works for admin-style idempotency keys that
// do NOT end in an employee_id.

import type { Queue } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePortalReconciliation } from '../../src/scheduled.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from '../integration/helpers/test-d1.js';

describe('handlePortalReconciliation reEnqueue → employeeId resolution (W38)', () => {
  let h: TestD1;
  let sentMessages: unknown[];
  let queue: Queue<unknown>;
  const sessionId = '01HZZ0000000000000000W38';

  beforeEach(async () => {
    h = await setupTestD1();
    sentMessages = [];
    queue = {
      send: vi.fn(async (msg: unknown) => {
        sentMessages.push(msg);
      }),
      sendBatch: vi.fn(),
    } as unknown as Queue<unknown>;

    // Schema fixtures.
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (7, '20731', 'Peter', 'Darley', 'LT', 'FF', 75, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('resolves employeeId via bids→members FK for an admin idempotency_key (no embedded emp_id)', async () => {
    // Admin force-pick style key: does NOT end in the employee_id.
    const adminKey = `force:${sessionId}:7:A101`;
    // `picked_at` is mode='timestamp' (seconds) per the schema.
    const nowSec = Math.floor(Date.now() / 1000);
    await h.db.run(
      "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES (?, ?, 1, 7, 'A101', ?, 1, ?, 'pending', 0);",
      ['bid-w38-1', sessionId, nowSec, adminKey],
    );
    // Queue row due NOW. enqueued_at and next_attempt_at are also seconds.
    await h.db.run(
      "INSERT INTO portal_writeback_queue (id, bid_id, enqueued_at, next_attempt_at, attempts, status, payload_json) VALUES (?, ?, ?, ?, 0, 'queued', ?);",
      [
        'q-w38-1',
        'bid-w38-1',
        nowSec - 60,
        nowSec - 30,
        JSON.stringify({ idempotency_key: adminKey, marker: 'forced' }),
      ],
    );

    const env: WorkerEnv = { ...h.env, PORTAL_QUEUE: queue };
    await handlePortalReconciliation(env);

    expect(sentMessages).toHaveLength(1);
    const msg = sentMessages[0] as { bidId: string; employeeId: string; queueRowId: string };
    expect(msg.bidId).toBe('bid-w38-1');
    expect(msg.employeeId).toBe('20731'); // resolved from members.id=7, NOT parsed from key
    expect(msg.queueRowId).toBe('q-w38-1');
  });

  it('skips silently when the bids row is missing', async () => {
    // No bids row inserted — the reEnqueue handler should return early.
    const nowSec = Math.floor(Date.now() / 1000);
    await h.db.run(
      "INSERT INTO portal_writeback_queue (id, bid_id, enqueued_at, next_attempt_at, attempts, status, payload_json) VALUES (?, ?, ?, ?, 0, 'queued', ?);",
      [
        'q-w38-2',
        'bid-w38-missing',
        nowSec - 60,
        nowSec - 30,
        JSON.stringify({ idempotency_key: 'abc' }),
      ],
    );

    const env: WorkerEnv = { ...h.env, PORTAL_QUEUE: queue };
    await handlePortalReconciliation(env);

    expect(sentMessages).toHaveLength(0);
  });
});
