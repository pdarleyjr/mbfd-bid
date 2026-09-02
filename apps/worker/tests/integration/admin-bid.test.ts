import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Unstable_DevWorker, unstable_dev } from 'wrangler';
import { signJwt } from '../../src/lib/jwt.js';

const KEY = 'test-key-with-at-least-32-characters-long';
const IDEM_A = '11111111-1111-4111-8111-111111111111';

describe('admin bid routes (Plan 04 Task 9)', () => {
  let worker: Unstable_DevWorker;
  let adminJwt: string;
  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      vars: {
        JWT_SIGNING_KEY: KEY,
        ENV: 'staging',
        PORTAL_BASE_URL: 'https://x.example',
        PORTAL_BID_FEDERATION_TOKEN: 'x',
      },
      durableObjects: [{ name: 'BID_SESSION', class_name: 'BidSessionDO' }],
    });
    adminJwt = await signJwt(
      {
        sub: 1,
        hub_user_id: 1,
        member_id: 1,
        emp: 'admin',
        role: 'admin',
        security_version: 1,
        rank: 'CHIEF',
        first_name: 'A',
        last_name: 'B',
        fresh_auth_at: Math.floor(Date.now() / 1000),
        authz_checked_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
  });
  afterAll(async () => worker.stop());

  it('POST /api/admin/bid/freeze returns 401 without admin JWT', async () => {
    const res = await worker.fetch('/api/admin/bid/freeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': IDEM_A },
      body: JSON.stringify({ bidSessionId: '01HSESS', reason: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/bid/freeze fails closed when the launcher cannot look up the D1 session', async () => {
    const res = await worker.fetch('/api/admin/bid/freeze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminJwt}`,
        'Idempotency-Key': IDEM_A,
      },
      body: JSON.stringify({ bidSessionId: '01HSESS', reason: 'Network outage' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'bid_session_lookup_unavailable' });
  });

  it('POST /api/admin/bid/freeze rejects when Idempotency-Key missing', async () => {
    const res = await worker.fetch('/api/admin/bid/freeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
      body: JSON.stringify({ bidSessionId: '01HSESS', reason: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});
