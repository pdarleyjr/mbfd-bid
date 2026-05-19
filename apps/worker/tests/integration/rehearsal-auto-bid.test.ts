import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'a'.repeat(64);

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

function stubBidSessionNamespace(snapshotFor: Map<string, unknown>): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      const u = new URL(url);
      if (u.pathname.endsWith('/snapshot')) {
        const id = u.pathname.split('/')[1] ?? 'unknown';
        const snap = snapshotFor.get(id) ?? { currentBidderId: null };
        return new Response(JSON.stringify(snap), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'id' }) as unknown as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'id' }) as unknown as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

async function seedMockSessionWithThreeMembers(h: TestD1, sessionId: string) {
  const now = Date.now();
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, current_bidder_id, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 201, 1);",
    [sessionId, now],
  );
  for (const m of [
    { id: 201, emp: '201201', sen: 100 },
    { id: 202, emp: '202202', sen: 200 },
    { id: 203, emp: '203203', sen: 300 },
  ]) {
    await h.db.run(
      'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?);',
      [m.id, m.emp, 'M', String(m.id), 'FF', 'FF', m.sen, now, now],
    );
  }
  await h.db.run(
    "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 201, 'FF'), (?, 2, 202, 'FF'), (?, 3, 203, 'FF');",
    [sessionId, sessionId, sessionId],
  );

  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  for (const p of ['A101', 'A102', 'A103']) {
    await h.db.run(
      "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES (?, '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', ?);",
      [p, `${p} unit`],
    );
  }
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
  );
  for (const p of ['A101', 'A102', 'A103']) {
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', ?, '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
      [p],
    );
  }
}

describe('POST /api/admin/rehearsal/:sessionId/auto-bid (Task R5)', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000REH010';

  beforeEach(async () => {
    h = await setupTestD1();
    await seedMockSessionWithThreeMembers(h, sessionId);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns 403 when the session is NOT marked mock', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 0 WHERE id = ?;', [sessionId]);
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 1, strategy: 'first_eligible' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(403);
  });

  it('makes 3 picks with strategy=first_eligible and stops at count_reached', async () => {
    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: 201 }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
    };
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 3, strategy: 'first_eligible' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picksMade: number; stoppedReason: string };
    expect(body.picksMade).toBe(3);
    expect(['count_reached', 'complete']).toContain(body.stoppedReason);

    const bidsRows = await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect((bidsRows.results[0] as { n: number }).n).toBe(3);
  });

  it('returns 400 on invalid body (count<=0 or unknown strategy)', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 0, strategy: 'first_eligible' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});
