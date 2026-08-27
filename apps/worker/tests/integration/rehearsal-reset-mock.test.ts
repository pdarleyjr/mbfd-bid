import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 's'.repeat(64);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'A',
      last_name: 'B',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

interface DoFetchCall {
  pathname: string;
  init?: RequestInit;
}

function stubBidSessionNamespace(calls: DoFetchCall[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      const u = new URL(url);
      calls.push({ pathname: u.pathname });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
  return {
    idFromName: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

describe('POST /api/admin/rehearsal/:sessionId/reset-mock (Task R4)', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000REH002';
  const otherSessionId = '01HZZ0000000000000000REH003';

  beforeEach(async () => {
    vi.restoreAllMocks();
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    // Two sessions: one mock (under test) and one not (control)
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [otherSessionId, Date.now()],
    );
    // Seed members + bid_order so the route can pick the first ordinal
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (101, '100101', 'Mock', 'Bidder', 'FF', 'FF', 500, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (102, '100102', 'Other', 'Bidder', 'FF', 'FF', 600, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 101, 'FF'), (?, 2, 102, 'FF');",
      [sessionId, sessionId],
    );
    // Insert a bid + an a_day_pick to verify they get cleared
    await h.db.run(
      "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES ('bid001', ?, 1, 101, 'A205', ?, 0, 'idem-1', 'pending', 0);",
      [sessionId, Math.floor(Date.now() / 1000)],
    );
    await h.db.run(
      "INSERT INTO a_day_picks (id, bid_session_id, member_id, shift, a_day, picked_at, forced, idempotency_key) VALUES ('aday001', ?, 101, 'A', 'G1', ?, 0, 'idem-2');",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns 403 when the session is NOT marked mock', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${otherSessionId}/reset-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the session does not exist', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rehearsal/01HZZNOSUCHSESSION0000000000/reset-mock', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(404);
  });

  it('fails closed without mutating a mock session until a reset epoch exists', async () => {
    const doCalls: DoFetchCall[] = [];
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(doCalls),
    };
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/reset-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      env,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'canonical_reset_requires_new_epoch' });

    const bidsRows = await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect((bidsRows.results[0] as { n: number }).n).toBe(1);
    const aDayRows = await h.db.run(
      'SELECT count(*) AS n FROM a_day_picks WHERE bid_session_id = ?',
      [sessionId],
    );
    expect((aDayRows.results[0] as { n: number }).n).toBe(1);

    const sessionRow = await h.db.run(
      'SELECT current_phase, current_bidder_id, current_turn_started_at, paused_at, completed_at, frozen_at FROM bid_sessions WHERE id = ?',
      [sessionId],
    );
    const s = sessionRow.results[0] as {
      current_phase: string;
      current_bidder_id: number;
      current_turn_started_at: number | null;
      paused_at: number | null;
      completed_at: number | null;
      frozen_at: number | null;
    };
    expect(s.current_phase).toBe('position_bid');
    expect(s.current_bidder_id).toBeNull();
    expect(s.current_turn_started_at).toBeNull();
    expect(s.paused_at).toBeNull();
    expect(s.completed_at).toBeNull();
    expect(s.frozen_at).toBeNull();

    expect(doCalls).toEqual([]);
  });

  it('fails closed before reset mutations once canonical command state exists', async () => {
    // 0022 only permits a canonical seed for a session without legacy picks.
    // Preserve a non-default legacy session row before the seed so the route
    // assertion can prove it leaves that row untouched.
    await h.db.run('DELETE FROM a_day_picks WHERE bid_session_id = ?', [sessionId]);
    await h.db.run('DELETE FROM bids WHERE bid_session_id = ?', [sessionId]);
    await h.db.run(
      `UPDATE bid_sessions
          SET current_phase = 'paused', current_bidder_id = 102, paused_at = ?, frozen_at = ?
        WHERE id = ?`,
      [Date.now(), Date.now(), sessionId],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?)`,
      [
        sessionId,
        0,
        JSON.stringify({ bidSessionId: sessionId, lastSeq: 0 }),
        Date.now(),
        Date.now(),
      ],
    );
    const doCalls: DoFetchCall[] = [];
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(doCalls),
    };

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/reset-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'canonical_reset_requires_new_epoch' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [sessionId]))
        .results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run('SELECT count(*) AS n FROM a_day_picks WHERE bid_session_id = ?', [
          sessionId,
        ])
      ).results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          'SELECT current_phase, current_bidder_id, paused_at, frozen_at FROM bid_sessions WHERE id = ?',
          [sessionId],
        )
      ).results,
    ).toMatchObject([{ current_phase: 'paused', current_bidder_id: 102 }]);
    expect(doCalls).toEqual([]);
  });
});
