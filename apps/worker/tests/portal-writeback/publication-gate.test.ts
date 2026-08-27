import type { MessageBatch } from '@cloudflare/workers-types';
import type { PortalPayload } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePortalPublicationPolicy } from '../../src/portal-writeback/publication-policy.js';
import { handlePortalQueueBatch } from '../../src/portal-writeback/queue-handler.js';
import type { QueueMessage } from '../../src/portal-writeback/queue-producer.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from '../integration/helpers/test-d1.js';

const sessionId = '01HZZLIVE00000000000000GATE';
const bidId = 'bid-publication-gate';

const payload: PortalPayload = {
  bid_year: 2026,
  bid_session_id: sessionId,
  rank_label: 'Firefighter',
  station_label: 'Station 1',
  shift_label: 'A Shift',
  unit_label: 'Engine 1',
  a_day_label: 'Pending Phase 2',
  position_id: 'A101',
  picked_at: '2026-09-22T14:23:00Z',
  idempotency_key: bidId,
  is_forced: false,
  admin_actor_employee_id: null,
};

function queueMessage(): QueueMessage {
  return {
    bidId,
    employeeId: '300401',
    queueRowId: 'qrow-publication-gate',
    attempts: 0,
    payload,
  };
}

function batchFor(message: QueueMessage) {
  const ack = vi.fn();
  const retry = vi.fn();
  const batch: MessageBatch = {
    queue: 'mbfd-portal-writebacks-staging',
    messages: [{ id: 'm-gate', timestamp: new Date(), body: message, attempts: 1, ack, retry }],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch;
  return { batch, ack, retry };
}

async function seedLiveBid(h: TestD1): Promise<void> {
  const now = Date.now();
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 0);",
    [sessionId, now],
  );
  await h.db.run(
    "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (401, '300401', 'Live', 'Bidder', 'FF', 'FF', 100, 0, ?, ?);",
    [now, now],
  );
  await h.db.run(
    "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES (?, ?, 1, 401, 'A101', ?, 0, ?, 'pending', 0);",
    [bidId, sessionId, Math.floor(now / 1000), bidId],
  );
}

function failingLookupDb(): WorkerEnv['DB'] {
  return {
    prepare(query: string) {
      if (/^\s*select/i.test(query)) throw new Error('D1 lookup unavailable');
      const statement = {
        bind: () => statement,
        run: async () => ({ success: true, meta: {} }),
        all: async () => ({ success: true, results: [], meta: {} }),
        first: async () => null,
        raw: async () => [],
      };
      return statement;
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as WorkerEnv['DB'];
}

describe('portal publication gate', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await seedLiveBid(h);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('does not post a live staging bid unless publication is explicitly enabled', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor(queueMessage());

    await handlePortalQueueBatch(batch, {
      ...h.env,
      PORTAL_WRITEBACK_ENABLED: 'false',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback-disabled.invalid',
      PORTAL_BID_WRITER: 'writer-present-but-disabled',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not publish from staging even when every other writeback signal is present', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor(queueMessage());
    const env = {
      ...h.env,
      ENV: 'staging' as const,
      PORTAL_WRITEBACK_ENABLED: 'true' as const,
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    };

    expect(resolvePortalPublicationPolicy(env)).toEqual({
      enabled: false,
      reason: 'publication_not_permitted_in_environment',
      portalBaseUrl: null,
      writerToken: null,
    });

    await handlePortalQueueBatch(batch, env);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not post when the writer credential is absent even with the flag enabled', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor(queueMessage());

    await handlePortalQueueBatch(batch, {
      ...h.env,
      ENV: 'production',
      PORTAL_WRITEBACK_ENABLED: 'true',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: '',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not post when an explicit enabled setting names an insecure endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor(queueMessage());

    await handlePortalQueueBatch(batch, {
      ...h.env,
      ENV: 'production',
      PORTAL_WRITEBACK_ENABLED: 'true',
      PORTAL_WRITEBACK_BASE_URL: 'http://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('retries without posting a malformed queued payload', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor({
      ...queueMessage(),
      payload: { idempotency_key: bidId } as unknown as PortalPayload,
    });

    await handlePortalQueueBatch(batch, {
      ...h.env,
      ENV: 'production',
      PORTAL_WRITEBACK_ENABLED: 'true',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('retries without posting when queued payload identity differs from the D1 bid', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor({
      ...queueMessage(),
      payload: { ...payload, bid_session_id: 'other-session' },
    });

    await handlePortalQueueBatch(batch, {
      ...h.env,
      ENV: 'production',
      PORTAL_WRITEBACK_ENABLED: 'true',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('retries without posting when mock-session lookup is unavailable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor(queueMessage());

    await handlePortalQueueBatch(batch, {
      ...h.env,
      ENV: 'production',
      DB: failingLookupDb(),
      PORTAL_WRITEBACK_ENABLED: 'true',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('permits a live publication only with explicit enabled state, writer, and dedicated endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { batch, ack, retry } = batchFor(queueMessage());

    await handlePortalQueueBatch(batch, {
      ...h.env,
      ENV: 'production',
      PORTAL_WRITEBACK_ENABLED: 'true',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
