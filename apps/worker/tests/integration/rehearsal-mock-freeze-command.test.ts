import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'm'.repeat(64);
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

async function jwt(role: 'admin' | 'member', freshAuthAt = Math.floor(Date.now() / 1000)) {
  return signJwt(
    {
      sub: role === 'admin' ? 0 : 9001,
      emp: role === 'admin' ? 'admin' : 'member',
      role,
      rank: role === 'admin' ? 'CHIEF' : 'FF',
      first_name: 'Test',
      last_name: role,
      fresh_auth_at: freshAuthAt,
    },
    KEY,
  );
}

interface DoFetchCall {
  pathname: string;
  method: string;
  body: unknown;
}

function stubBidSessionNamespace(calls: DoFetchCall[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const bodyText =
        typeof input === 'string'
          ? typeof init?.body === 'string'
            ? init.body
            : ''
          : await input.clone().text();
      calls.push({
        pathname: new URL(url).pathname,
        method: typeof input === 'string' ? (init?.method ?? 'GET') : input.method,
        body: bodyText === '' ? null : JSON.parse(bodyText),
      });
      return new Response(
        JSON.stringify({
          kind: 'accepted',
          commandId: COMMAND_ID,
          seq: 8,
          envelope: { v: 1, seq: 8, ts: 1700000000000, type: 'freeze', payload: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

describe('POST /api/admin/rehearsal/:sessionId/commands/freeze', () => {
  const mockSessionId = '01HZZ0000000000000MOCKCMD1';
  const liveSessionId = '01HZZ0000000000000LIVECMD1';
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 0, 1);",
      [mockSessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 0, 0);",
      [liveSessionId, Date.now()],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  function request(sessionId: string, headers: HeadersInit, body: unknown) {
    return new Request(`http://x/api/admin/rehearsal/${sessionId}/commands/freeze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('accepts a mock-only command, supplies trusted identity, and does not project a D1 freeze', async () => {
    const calls: DoFetchCall[] = [];
    const res = await app.fetch(
      request(
        mockSessionId,
        {
          Authorization: `Bearer ${await jwt('admin')}`,
          'Idempotency-Key': COMMAND_ID,
        },
        { expectedSeq: 7, reason: 'Mock exercise pause' },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace(calls) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'accepted', commandId: COMMAND_ID, seq: 8 });
    expect(calls).toEqual([
      {
        pathname: '/admin/commands/mock-freeze',
        method: 'POST',
        body: {
          v: 1,
          type: 'mock.freeze',
          commandId: COMMAND_ID,
          bidSessionId: mockSessionId,
          expectedSeq: 7,
          actor: { id: 0, role: 'admin' },
          reason: 'Mock exercise pause',
        },
      },
    ]);

    const row = await h.db.run('SELECT frozen_at FROM bid_sessions WHERE id = ?', [mockSessionId]);
    expect((row.results[0] as { frozen_at: number | null }).frozen_at).toBeNull();
  });

  it('rejects a non-mock session before contacting the DO', async () => {
    const calls: DoFetchCall[] = [];
    const res = await app.fetch(
      request(
        liveSessionId,
        {
          Authorization: `Bearer ${await jwt('admin')}`,
          'Idempotency-Key': COMMAND_ID,
        },
        { expectedSeq: 7, reason: 'Mock exercise pause' },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace(calls) },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'not_a_mock_session' });
    expect(calls).toEqual([]);
  });

  it('requires an existing mock session, fresh admin authority, and valid command input', async () => {
    const cases: Array<{
      label: string;
      sessionId: string;
      headers: HeadersInit;
      body: unknown;
      status: number;
    }> = [
      {
        label: 'missing session',
        sessionId: '01HZZ0000000000000MISSING1',
        headers: { Authorization: `Bearer ${await jwt('admin')}`, 'Idempotency-Key': COMMAND_ID },
        body: { expectedSeq: 7, reason: 'Mock exercise pause' },
        status: 404,
      },
      {
        label: 'stale step-up',
        sessionId: mockSessionId,
        headers: {
          Authorization: `Bearer ${await jwt('admin', Math.floor(Date.now() / 1000) - 600)}`,
          'Idempotency-Key': COMMAND_ID,
        },
        body: { expectedSeq: 7, reason: 'Mock exercise pause' },
        status: 401,
      },
      {
        label: 'member caller',
        sessionId: mockSessionId,
        headers: { Authorization: `Bearer ${await jwt('member')}`, 'Idempotency-Key': COMMAND_ID },
        body: { expectedSeq: 7, reason: 'Mock exercise pause' },
        status: 403,
      },
      {
        label: 'missing command id',
        sessionId: mockSessionId,
        headers: { Authorization: `Bearer ${await jwt('admin')}` },
        body: { expectedSeq: 7, reason: 'Mock exercise pause' },
        status: 400,
      },
      {
        label: 'invalid expected sequence',
        sessionId: mockSessionId,
        headers: { Authorization: `Bearer ${await jwt('admin')}`, 'Idempotency-Key': COMMAND_ID },
        body: { expectedSeq: -1, reason: 'Mock exercise pause' },
        status: 400,
      },
    ];

    for (const entry of cases) {
      const calls: DoFetchCall[] = [];
      const res = await app.fetch(request(entry.sessionId, entry.headers, entry.body), {
        ...h.env,
        JWT_SIGNING_KEY: KEY,
        BID_SESSION: stubBidSessionNamespace(calls),
      });
      expect(res.status, entry.label).toBe(entry.status);
      expect(calls, entry.label).toEqual([]);
    }
  });
});
