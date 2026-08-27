import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'a'.repeat(64);
const SESSION_ID = '01HZZ0000000000000ADAYCAN';

function stubBidSessionNamespace(calls: string[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string) => {
      calls.push(typeof input === 'string' ? new URL(input).pathname : new URL(input.url).pathname);
      return new Response(JSON.stringify({ kind: 'accepted' }), {
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

async function freshAdmin(): Promise<string> {
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

describe('POST /api/admin/bid-session/:id/force-a-day canonical guard', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock
      ) VALUES (?, 2026, 1, 'a_day_bid', 180, 2, 0, 1);`,
      [SESSION_ID],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 0, ?, NULL, 1, 1);`,
      [SESSION_ID, JSON.stringify({ bidSessionId: SESSION_ID, lastSeq: 0 })],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('rejects before contacting the DO or creating legacy A-Day evidence', async () => {
    const calls: string[] = [];
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${SESSION_ID}/force-a-day`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 7,
          a_day: 'G1',
          reason: 'Canonical authority blocks this legacy forced A-Day path.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace(calls) },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'canonical_mutation_requires_command' });
    expect(calls).toEqual([]);
    expect(
      (
        await h.db.run('SELECT count(*) AS n FROM a_day_picks WHERE bid_session_id = ?', [
          SESSION_ID,
        ])
      ).results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ? AND action = 'forced_a_day_pick'",
          [SESSION_ID],
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });
});
