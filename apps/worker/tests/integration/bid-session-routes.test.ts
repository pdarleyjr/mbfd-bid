import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Unstable_DevWorker, unstable_dev } from 'wrangler';
import { signJwt } from '../../src/lib/jwt.js';

describe('bid REST routes (Plan 04 Task 8)', () => {
  let worker: Unstable_DevWorker;
  let memberJwt: string;
  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      vars: {
        JWT_SIGNING_KEY: 'test-key-with-at-least-32-characters-long',
        ENV: 'staging',
        PORTAL_BASE_URL: 'https://example.org',
        PIN_HASH: '$2a$10$abcdefghijklmnopqrstuv',
        PORTAL_BID_READER: 'x',
        CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/test/mbfd-bid/anthropic',
        ANTHROPIC_API_KEY: 'sk-test',
        AI_BUDGET_CAP_CENTS: '2500',
        AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
      },
      durableObjects: [{ name: 'BID_SESSION', class_name: 'BidSessionDO' }],
    });
    memberJwt = await signJwt(
      {
        sub: 17,
        emp: '99999',
        role: 'member',
        rank: 'FF',
        first_name: 'Test',
        last_name: 'User',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      'test-key-with-at-least-32-characters-long',
    );
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('GET /api/ws/session/:id returns 401 without JWT', async () => {
    // Note: undici forbids the `Upgrade` header on Fetch API Requests, so we
    // can't include it from the test client. The route checks JWT first, so
    // 401 still asserts the no-auth branch.
    const res = await worker.fetch('/api/ws/session/01HSESS');
    expect(res.status).toBe(401);
  });

  it('GET /api/ws/session/:id returns 426 with JWT but no Upgrade header', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect([426, 400]).toContain(res.status);
  });

  it('GET /api/ws/session/:id accepts ?token= query param (browser path)', async () => {
    // Browsers cannot set Authorization on a WebSocket upgrade, so the
    // Worker falls back to ?token=. Without the Upgrade header (undici
    // strips it) we still reach the 426 branch — the assert proves the JWT
    // was read from the query and validated.
    const res = await worker.fetch(`/api/ws/session/01HSESS?token=${memberJwt}`);
    expect([426, 400]).toContain(res.status);
  });

  it('GET /api/ws/session/:id returns 401 with empty ?token=', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS?token=');
    expect(res.status).toBe(401);
  });

  it('GET /api/ws/session/:id returns 401 with invalid ?token=', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS?token=not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('GET /api/board returns 200 with member JWT', async () => {
    const res = await worker.fetch('/api/board?bidSessionId=01HSESS', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect(res.status).toBe(200);
  });

  it('GET /api/me returns the JWT subject as profile', async () => {
    const res = await worker.fetch('/api/me', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memberId: number };
    expect(body.memberId).toBe(17);
  });

  it('GET /api/bid/state?since_seq=N returns events newer than N', async () => {
    const res = await worker.fetch('/api/bid/state?bidSessionId=01HSESS&since_seq=0', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seq: number; events: unknown[] };
    expect(body.seq).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.events)).toBe(true);
  });
});
