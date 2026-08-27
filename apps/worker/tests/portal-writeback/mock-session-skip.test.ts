// Plan 09 / Rehearsal Tooling — Task R8.
//
// The portal write-back consumer MUST skip any bid that belongs to a mock
// session. Verified by injecting a queue message whose bidId resolves (via
// D1) to a session row with is_mock=1 and asserting the portal HTTP client
// is never invoked.

import type { MessageBatch } from '@cloudflare/workers-types';
import type { PortalPayload } from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';

import { handlePortalQueueBatch } from '../../src/portal-writeback/queue-handler.js';
import type { QueueMessage } from '../../src/portal-writeback/queue-producer.js';
import { setupTestD1, teardownTestD1 } from '../integration/helpers/test-d1.js';

const payload: PortalPayload = {
  bid_year: 2026,
  bid_session_id: '01HZZMOCK00000000000000000',
  rank_label: 'Firefighter',
  station_label: 'Station 1',
  shift_label: 'A Shift',
  unit_label: 'Engine 1',
  a_day_label: 'Pending Phase 2',
  position_id: 'A101',
  picked_at: '2026-09-22T14:23:00Z',
  idempotency_key: 'bid_mock_1',
  is_forced: false,
  admin_actor_employee_id: null,
};

function buildMessage(): { msg: QueueMessage; ack: () => void; retry: () => void } {
  const ack = vi.fn();
  const retry = vi.fn();
  const queueMessage: QueueMessage = {
    bidId: 'bid_mock_1',
    employeeId: '12345',
    queueRowId: 'qrow_mock_1',
    attempts: 0,
    payload,
  };
  return { msg: queueMessage, ack, retry };
}

describe('Portal queue consumer skips mock sessions (Task R8)', () => {
  it('does NOT call the portal HTTP client when the bid belongs to a mock session', async () => {
    const h = await setupTestD1();
    try {
      const now = Date.now();
      await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
      await h.db.run(
        "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 1);",
        ['01HZZMOCK00000000000000000', now],
      );
      await h.db.run(
        "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (300, '300300', 'Mock', 'Bidder', 'FF', 'FF', 100, 0, ?, ?);",
        [now, now],
      );
      await h.db.run(
        "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES ('bid_mock_1', '01HZZMOCK00000000000000000', 1, 300, 'A101', ?, 0, 'idem-mock-1', 'pending', 0);",
        [Math.floor(now / 1000)],
      );

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

      const { msg, ack, retry } = buildMessage();
      const batch: MessageBatch = {
        queue: 'mbfd-portal-writebacks-staging',
        messages: [
          {
            id: 'm-1',
            timestamp: new Date(),
            body: msg,
            attempts: 1,
            ack,
            retry,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch;

      // Pass an env where PORTAL_QUEUE.send would throw if called; the
      // consumer must not enqueue a retry either.
      const env = {
        ...h.env,
        ENV: 'production' as const,
        PORTAL_BASE_URL: 'https://portal.example',
        PORTAL_WRITEBACK_ENABLED: 'true' as const,
        PORTAL_WRITEBACK_BASE_URL: 'https://portal.example',
        PORTAL_BID_WRITER: 'tok',
        PORTAL_QUEUE: {
          send: vi.fn(async () => {
            throw new Error('PORTAL_QUEUE.send must not be called for mock sessions');
          }),
        } as never,
      };

      await handlePortalQueueBatch(batch, env);

      // The portal HTTP client must NOT have fired
      const portalCalls = fetchSpy.mock.calls.filter((args) => {
        const url = String(args[0]);
        return url.includes('portal.example');
      });
      expect(portalCalls.length).toBe(0);
      expect(ack).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    } finally {
      await teardownTestD1(h);
    }
  });

  it('still posts to the portal for a non-mock (live) session', async () => {
    const h = await setupTestD1();
    try {
      const now = Date.now();
      await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
      await h.db.run(
        "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 0);",
        ['01HZZLIVE00000000000000001', now],
      );
      await h.db.run(
        "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (301, '300301', 'Live', 'Bidder', 'FF', 'FF', 100, 0, ?, ?);",
        [now, now],
      );
      await h.db.run(
        "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES ('bid_live_1', '01HZZLIVE00000000000000001', 1, 301, 'A101', ?, 0, 'idem-live-1', 'pending', 0);",
        [Math.floor(now / 1000)],
      );

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));

      const ack = vi.fn();
      const retry = vi.fn();
      const livePayload: PortalPayload = {
        ...payload,
        bid_session_id: '01HZZLIVE00000000000000001',
        idempotency_key: 'bid_live_1',
      };
      const liveMessage: QueueMessage = {
        bidId: 'bid_live_1',
        employeeId: '300301',
        queueRowId: 'qrow_live_1',
        attempts: 0,
        payload: livePayload,
      };
      const batch: MessageBatch = {
        queue: 'mbfd-portal-writebacks-staging',
        messages: [
          { id: 'm-2', timestamp: new Date(), body: liveMessage, attempts: 1, ack, retry },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch;

      await handlePortalQueueBatch(batch, {
        ...h.env,
        ENV: 'production',
        PORTAL_BASE_URL: 'https://portal.example',
        PORTAL_WRITEBACK_ENABLED: 'true' as const,
        PORTAL_WRITEBACK_BASE_URL: 'https://portal.example',
        PORTAL_BID_WRITER: 'tok',
        PORTAL_QUEUE: { send: vi.fn(async () => {}) } as never,
      });

      const portalCalls = fetchSpy.mock.calls.filter((args) => {
        const url = String(args[0]);
        return url.includes('portal.example');
      });
      expect(portalCalls.length).toBeGreaterThan(0);
      expect(ack).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    } finally {
      await teardownTestD1(h);
    }
  });
});
