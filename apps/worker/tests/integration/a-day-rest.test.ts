import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Unstable_DevWorker, unstable_dev } from 'wrangler';
import { signJwt } from '../../src/lib/jwt.js';

describe('A-Day REST routes (Plan 07 Task 13)', () => {
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
        AI_BUDGET_CAP_CENTS: '2500',
        AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
      },
      durableObjects: [{ name: 'BID_SESSION', class_name: 'BidSessionDO' }],
    });
    memberJwt = await signJwt(
      {
        sub: 1,
        emp: '1',
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

  it('GET /api/bid/a-day-state returns 401 without JWT', async () => {
    const res = await worker.fetch('/api/bid/a-day-state?session=01HSESS');
    expect(res.status).toBe(401);
  });

  it('GET /api/bid/a-day-state returns 400 without session query', async () => {
    const res = await worker.fetch('/api/bid/a-day-state', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/bid/a-day-state returns empty meters when session is in config phase', async () => {
    const res = await worker.fetch('/api/bid/a-day-state?session=01HSESS', {
      headers: { Authorization: `Bearer ${memberJwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      currentPhase: string;
      isMyTurn: boolean;
      eligibleADays: string[];
    };
    expect(['config', 'position_bid', 'paused', 'complete']).toContain(body.currentPhase);
    expect(body.isMyTurn).toBe(false);
    expect(body.eligibleADays).toEqual([]);
  });

  it('POST /api/bid/a-day-pick returns 401 without JWT', async () => {
    const res = await worker.fetch('/api/bid/a-day-pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        bidSessionId: '01HSESS',
        aDay: 'G1',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/bid/a-day-pick returns 400 on malformed body', async () => {
    const res = await worker.fetch('/api/bid/a-day-pick', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
      },
      body: JSON.stringify({ v: 1, bidSessionId: 'x', aDay: 'BADVAL', idempotencyKey: 'no' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/bid/a-day-pick returns 403 when session is not in a_day_bid phase', async () => {
    const res = await worker.fetch('/api/bid/a-day-pick', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${memberJwt}`,
      },
      body: JSON.stringify({
        v: 1,
        bidSessionId: '01HSESS',
        aDay: 'G1',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe('PHASE_NOT_A_DAY_BID');
  });
});
