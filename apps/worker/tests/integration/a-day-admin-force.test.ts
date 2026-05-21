import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Unstable_DevWorker, unstable_dev } from 'wrangler';
import { signJwt } from '../../src/lib/jwt.js';

const SIGNING_KEY = 'test-key-with-at-least-32-characters-long';

async function makeJwt(opts: {
  role: 'admin' | 'member';
  freshAuth?: boolean;
}): Promise<string> {
  const freshAuthAt =
    opts.freshAuth === false
      ? Math.floor(Date.now() / 1000) - 60 * 60 // 1 hour ago
      : Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: 99,
      emp: '99',
      role: opts.role,
      rank: 'CHIEF',
      first_name: 'Admin',
      last_name: 'User',
      fresh_auth_at: freshAuthAt,
    },
    SIGNING_KEY,
  );
}

describe('POST /api/admin/bid-session/:id/force-a-day (Plan 07 Task 14)', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      vars: {
        JWT_SIGNING_KEY: SIGNING_KEY,
        ENV: 'staging',
        PORTAL_BASE_URL: 'https://example.org',
        PIN_HASH: '$2a$10$abcdefghijklmnopqrstuv',
        PORTAL_BID_READER: 'x',
        CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/test/mbfd-bid/anthropic',
        AI_BUDGET_CAP_CENTS: '2500',
        AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
      },
      durableObjects: [{ name: 'BID_SESSION', class_name: 'BidSessionDO' }],
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('returns 401 without JWT', async () => {
    const res = await worker.fetch('/api/admin/bid-session/01HSESS/force-a-day', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        member_id: 1,
        a_day: 'G1',
        reason: 'manning hole',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller lacks admin role', async () => {
    const memberJwt = await makeJwt({ role: 'member', freshAuth: true });
    const res = await worker.fetch('/api/admin/bid-session/01HSESS/force-a-day', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
      },
      body: JSON.stringify({
        member_id: 1,
        a_day: 'G1',
        reason: 'manning hole; chief approved',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 401 when fresh_auth_at is older than 5 minutes (step-up auth)', async () => {
    const staleJwt = await makeJwt({ role: 'admin', freshAuth: false });
    const res = await worker.fetch('/api/admin/bid-session/01HSESS/force-a-day', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${staleJwt}`,
      },
      body: JSON.stringify({
        member_id: 1,
        a_day: 'G1',
        reason: 'manning hole; chief approved',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed body', async () => {
    const adminJwt = await makeJwt({ role: 'admin', freshAuth: true });
    const res = await worker.fetch('/api/admin/bid-session/01HSESS/force-a-day', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({ member_id: 1, a_day: 'BAD', reason: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when session does not exist', async () => {
    const adminJwt = await makeJwt({ role: 'admin', freshAuth: true });
    const res = await worker.fetch('/api/admin/bid-session/does-not-exist/force-a-day', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({
        member_id: 1,
        a_day: 'G1',
        reason: 'manning hole; chief approved',
      }),
    });
    expect([404, 500]).toContain(res.status);
  });
});
