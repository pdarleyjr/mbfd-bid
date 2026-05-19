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

  it('POST /portal-retry/:bid_id returns 404 for unknown bid', async () => {
    const jwt = await adminJwt(h.env);
    const res = await mkApp().request(
      '/api/admin/portal-retry/bogus_bid',
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
      h.env,
    );
    expect(res.status).toBe(404);
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
