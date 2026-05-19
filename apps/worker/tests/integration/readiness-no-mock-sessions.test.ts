// W-MOCKSAFETY — Cutover safety readiness probe.
//
// `/api/admin/readiness/no-mock-sessions` returns `{ ok, openMockSessions }`.
// `ok` is true iff every `is_mock=1` session is in a closed phase.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'r'.repeat(64);

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

describe('GET /api/admin/readiness/no-mock-sessions (W-MOCKSAFETY)', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns ok=true when no mock sessions exist', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/readiness/no-mock-sessions', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; openMockSessions: string[] };
    expect(body.ok).toBe(true);
    expect(body.openMockSessions).toEqual([]);
  });

  it('returns ok=true when every mock session is `complete`', async () => {
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES ('mock-complete', 2026, ?, 'complete', 180, 2, 1, 1);",
      [Date.now()],
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/readiness/no-mock-sessions', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; openMockSessions: string[] };
    expect(body.ok).toBe(true);
    expect(body.openMockSessions).toEqual([]);
  });

  it('returns ok=false and lists open mock sessions when at least one is still live', async () => {
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES ('mock-open-1', 2026, ?, 'position_bid', 180, 2, 1, 1);",
      [Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES ('mock-paused', 2026, ?, 'paused', 180, 2, 1, 1);",
      [Date.now()],
    );
    // A non-mock live session must NOT show up — it's irrelevant to this gate.
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES ('real-live', 2026, ?, 'position_bid', 180, 2, 1, 0);",
      [Date.now()],
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/readiness/no-mock-sessions', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; openMockSessions: string[] };
    expect(body.ok).toBe(false);
    expect(body.openMockSessions.sort()).toEqual(['mock-open-1', 'mock-paused']);
  });

  it('archiving an open mock session flips the gate to ok=true', async () => {
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES ('mock-to-archive', 2026, ?, 'position_bid', 180, 2, 1, 1);",
      [Date.now()],
    );

    const r1 = (await (
      await app.fetch(
        new Request('http://x/api/admin/readiness/no-mock-sessions', {
          headers: { Authorization: `Bearer ${await adminJwt()}` },
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      )
    ).json()) as { ok: boolean; openMockSessions: string[] };
    expect(r1.ok).toBe(false);
    expect(r1.openMockSessions).toContain('mock-to-archive');

    await h.db.run(
      "UPDATE bid_sessions SET current_phase = 'complete' WHERE id = 'mock-to-archive';",
    );

    const r2 = (await (
      await app.fetch(
        new Request('http://x/api/admin/readiness/no-mock-sessions', {
          headers: { Authorization: `Bearer ${await adminJwt()}` },
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      )
    ).json()) as { ok: boolean; openMockSessions: string[] };
    expect(r2.ok).toBe(true);
    expect(r2.openMockSessions).toEqual([]);
  });

  it('requires admin auth — 401 without JWT', async () => {
    const res = await app.fetch(new Request('http://x/api/admin/readiness/no-mock-sessions'), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(res.status).toBe(401);
  });
});
