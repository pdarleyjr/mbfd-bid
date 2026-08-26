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

async function memberJwt(): Promise<string> {
  return signJwt(
    {
      sub: 9001,
      emp: 'm9001',
      role: 'member',
      rank: 'FF',
      first_name: 'Rey',
      last_name: 'Mock',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function staleAdminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'A',
      last_name: 'B',
      fresh_auth_at: Math.floor(Date.now() / 1000) - 600,
    },
    KEY,
  );
}

describe('POST /api/admin/rehearsal/:sessionId/mark-mock (Task R3)', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000REH001';

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'config', 180, 2, 0);",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns 401 without JWT', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, { method: 'POST' }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not an admin', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(403);
  });

  it('requires fresh step-up authentication', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await staleAdminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the session does not exist', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rehearsal/01HZZNOTASESSION00000000000/mark-mock', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(404);
  });

  it('marks the session as mock (is_mock=1) for an admin caller', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);

    const rows = await h.db.run('SELECT is_mock FROM bid_sessions WHERE id = ?', [sessionId]);
    expect((rows.results[0] as { is_mock: number }).is_mock).toBe(1);
  });

  it('is idempotent — repeat call still returns 200 and leaves is_mock=1', async () => {
    const make = async () =>
      app.fetch(
        new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await adminJwt()}` },
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
    const r1 = await make();
    const r2 = await make();
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const rows = await h.db.run('SELECT is_mock FROM bid_sessions WHERE id = ?', [sessionId]);
    expect((rows.results[0] as { is_mock: number }).is_mock).toBe(1);
  });

  it('refuses to reclassify a session after it has left config', async () => {
    await h.db.run("UPDATE bid_sessions SET current_phase = 'position_bid' WHERE id = ?", [
      sessionId,
    ]);

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'mock_reclassification_not_allowed' });
  });

  it('refuses to reclassify a config session that already has a pick', async () => {
    await h.db.run(
      `INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('mock-gate-pick', ?, 1, 0, 'A101', ?, 0, 'mock-gate-pick-key', 'pending', 0);`,
      [sessionId, Date.now()],
    );

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'mock_reclassification_not_allowed' });
  });

  it('audits a successful mock designation', async () => {
    await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/mark-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    const rows = await h.db.run(
      "SELECT action FROM audit_log WHERE bid_session_id = ? AND action = 'mark_mock'",
      [sessionId],
    );
    expect(rows.results).toHaveLength(1);
  });
});
