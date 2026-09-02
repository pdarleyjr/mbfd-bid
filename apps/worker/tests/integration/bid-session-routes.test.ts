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
        PORTAL_BID_FEDERATION_TOKEN: 'x',
      },
      durableObjects: [{ name: 'BID_SESSION', class_name: 'BidSessionDO' }],
    });
    memberJwt = await signJwt(
      {
        sub: 17,
        hub_user_id: 17,
        member_id: 17,
        emp: '99999',
        role: 'member',
        security_version: 1,
        rank: 'FF',
        first_name: 'Test',
        last_name: 'User',
        fresh_auth_at: Math.floor(Date.now() / 1000),
        authz_checked_at: Math.floor(Date.now() / 1000),
      },
      'test-key-with-at-least-32-characters-long',
    );
  });
  afterAll(async () => {
    await worker.stop();
  });

  it('GET /api/ws/session/:id rejects a request without the exact browser origin before auth', async () => {
    // Note: undici forbids the `Upgrade` header on Fetch API Requests, so we
    // can't include it from the test client. The public WebSocket endpoint
    // deliberately validates the exact browser origin before authentication.
    const res = await worker.fetch('/api/ws/session/01HSESS');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'websocket_origin_forbidden' });
  });

  it('GET /api/ws/session/:id returns 426 with JWT but no Upgrade header', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS', {
      headers: {
        Authorization: `Bearer ${memberJwt}`,
        Origin: 'https://staging.bid.mbfdhub.com',
      },
    });
    expect([426, 400]).toContain(res.status);
  });

  it('GET /api/ws/session/:id rejects a cross-environment browser origin', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS', {
      headers: {
        Authorization: `Bearer ${memberJwt}`,
        Origin: 'https://bid.mbfdhub.com',
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'websocket_origin_forbidden' });
  });

  it('GET /api/ws/session/:id rejects a JWT request without a browser origin', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'websocket_origin_forbidden' });
  });

  it('GET /api/ws/session/:id rejects an empty query credential without a browser origin', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS?token=');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'websocket_origin_forbidden' });
  });

  it('GET /api/ws/session/:id rejects an invalid query credential without a browser origin', async () => {
    const res = await worker.fetch('/api/ws/session/01HSESS?token=not-a-jwt');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'websocket_origin_forbidden' });
  });

  it('GET /api/board fails closed when the launcher has no canonical D1 authority', async () => {
    const res = await worker.fetch('/api/board?bidSessionId=01HSESS', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'canonical_state_unavailable' });
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
