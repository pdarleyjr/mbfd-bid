import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signJwt } from '../../src/lib/jwt.js';
import adminPortal from '../../src/routes/admin/portal.js';
import { setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

async function adminJwt(env: { JWT_SIGNING_KEY: string }): Promise<string> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: 0,
    emp: 'admin',
    role: 'admin',
    rank: 'CHIEF',
    first_name: 'A',
    last_name: 'B',
    fresh_auth_at: Math.floor(Date.now() / 1000),
  };
  return signJwt(payload, env.JWT_SIGNING_KEY);
}

describe('admin portal endpoints (Plan 08 Task 24)', () => {
  let h: Awaited<ReturnType<typeof setupTestD1>>;
  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(() => teardownTestD1(h));

  function mkApp() {
    return new Hono<{ Bindings: typeof h.env }>().route('/api/admin', adminPortal);
  }

  it('POST /portal-retry/:bid_id requires admin', async () => {
    const res = await mkApp().request('/api/admin/portal-retry/bid_r1', { method: 'POST' }, h.env);
    expect(res.status).toBe(401);
  });

  it('POST /portal-retry/:bid_id is unavailable while publication is disabled', async () => {
    const jwt = await adminJwt(h.env);
    const res = await mkApp().request(
      '/api/admin/portal-retry/bogus_bid',
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
      h.env,
    );
    expect(res.status).toBe(409);
  });

  it('POST /portal-retry/:bid_id rejects a bid that has not failed', async () => {
    const now = Math.floor(Date.now() / 1000);
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES ('session-retry', 2026, ?, 'position_bid', 180, 2, 1);",
      [now],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (9001, '9001', 'Test', 'Member', 'FF', 'FF', 1, 0, ?, ?);",
      [now, now],
    );
    await h.db.run(
      "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES ('bid-retry-synced', 'session-retry', 1, 9001, 'A101', ?, 0, 'retry-request', 'synced', 1);",
      [now],
    );
    const env = {
      ...h.env,
      ENV: 'production' as const,
      PORTAL_WRITEBACK_ENABLED: 'true' as const,
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    };
    const jwt = await adminJwt(env);

    const res = await mkApp().request(
      '/api/admin/portal-retry/bid-retry-synced',
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'portal_retry_requires_failed_bid' });
  });

  it('leaves a failed portal bid untouched when its pre-state audit receipt fails', async () => {
    const now = Math.floor(Date.now() / 1000);
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES ('session-audit-failure', 2026, ?, 'position_bid', 180, 2, 1);",
      [now],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (9002, '9002', 'Test', 'Member', 'FF', 'FF', 1, 0, ?, ?);",
      [now, now],
    );
    await h.db.run(
      "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES ('bid-audit-failure', 'session-audit-failure', 1, 9002, 'A101', ?, 0, 'audit-failure-request', 'failed', 2);",
      [now],
    );
    const env = {
      ...h.env,
      ENV: 'production' as const,
      PORTAL_WRITEBACK_ENABLED: 'true' as const,
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'writer-token',
    };
    h.failNextBatchAt(0);
    const jwt = await adminJwt(env);

    const response = await mkApp().request(
      '/api/admin/portal-retry/bid-audit-failure',
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );

    expect(response.status).toBe(500);
    expect(
      (await h.db.run("SELECT portal_sync_status FROM bids WHERE id = 'bid-audit-failure'"))
        .results,
    ).toEqual([{ portal_sync_status: 'failed' }]);
    expect(
      (
        await h.db.run(
          "SELECT COUNT(*) AS n FROM audit_log WHERE target_kind = 'portal_writeback_bid' AND target_id = 'bid-audit-failure'",
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });

  it('GET /portal-status/:session_id returns empty list for unknown session', async () => {
    const jwt = await adminJwt(h.env);
    const res = await mkApp().request(
      '/api/admin/portal-status/01HEMPTY',
      { headers: { Authorization: `Bearer ${jwt}` } },
      h.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bids: unknown[] };
    expect(body.bids).toEqual([]);
  });

  it('POST /portal-clear-year requires correct confirmation phrase', async () => {
    const jwt = await adminJwt(h.env);
    const wrong = await mkApp().request(
      '/api/admin/portal-clear-year',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ year: 2026, confirmation_phrase: 'wrong phrase' }),
      },
      h.env,
    );
    expect(wrong.status).toBe(400);
    const wrongBody = (await wrong.json()) as { error: string; expected: string };
    expect(wrongBody.expected).toBe('CLEAR YEAR 2026');
  });

  it('POST /portal-clear-year returns 0 cleared when no bids exist for year', async () => {
    const jwt = await adminJwt(h.env);
    const res = await mkApp().request(
      '/api/admin/portal-clear-year',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ year: 2026, confirmation_phrase: 'CLEAR YEAR 2026' }),
      },
      h.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleared: number };
    expect(body.cleared).toBe(0);
  });

  it('POST /portal-clear-year rejects malformed body', async () => {
    const jwt = await adminJwt(h.env);
    const res = await mkApp().request(
      '/api/admin/portal-clear-year',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ year: 1900 }),
      },
      h.env,
    );
    expect(res.status).toBe(400);
  });
});
