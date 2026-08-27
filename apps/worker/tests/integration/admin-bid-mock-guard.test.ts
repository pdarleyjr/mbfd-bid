import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'm'.repeat(64);
const SESSION_ID = '01HZZ0000000000000MOCKGUARD';
const IDEM = '11111111-1111-4111-8111-111111111111';

function stubBidSessionNamespace(calls: string[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string) => {
      calls.push(typeof input === 'string' ? new URL(input).pathname : new URL(input.url).pathname);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Test',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('generic admin bid commands on mock sessions', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock
      ) VALUES (?, 2026, 1, 'position_bid', 180, 2, 0, 1);`,
      [SESSION_ID],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it.each([
    {
      path: '/api/admin/bid/skip',
      body: { bidSessionId: SESSION_ID, reason: 'Rehearsal safety guard' },
    },
    {
      path: '/api/admin/bid/override',
      body: {
        bidSessionId: SESSION_ID,
        targetMemberId: 42,
        positionId: 'A101',
        reason: 'Rehearsal safety guard',
      },
    },
    {
      path: '/api/admin/bid/freeze',
      body: { bidSessionId: SESSION_ID, reason: 'Rehearsal safety guard' },
    },
  ])('rejects $path before contacting the legacy DO command', async ({ path, body }) => {
    const calls: string[] = [];
    const res = await app.fetch(
      new Request(`http://x${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await adminJwt()}`,
          'Idempotency-Key': IDEM,
        },
        body: JSON.stringify(body),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace(calls) },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'mock_session_requires_rehearsal_command' });
    expect(calls).toEqual([]);
  });

  it('keeps the generic live-session freeze route available to its existing DO implementation', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 0 WHERE id = ?', [SESSION_ID]);
    const calls: string[] = [];
    const res = await app.fetch(
      new Request('http://x/api/admin/bid/freeze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await adminJwt()}`,
          'Idempotency-Key': IDEM,
        },
        body: JSON.stringify({ bidSessionId: SESSION_ID, reason: 'Live route remains separate' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace(calls) },
    );

    expect(res.status).toBe(200);
    expect(calls).toEqual(['/admin/freeze']);
  });
});
