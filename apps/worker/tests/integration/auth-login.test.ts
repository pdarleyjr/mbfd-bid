import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import auth from '../../src/routes/auth';
import type { WorkerEnv } from '../../src/types/env';

const ORIG_FETCH = globalThis.fetch;

function mkEnv(): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.test',
    JWT_SIGNING_KEY: 'A'.repeat(64),
    PIN_HASH: '$2b$12$placeholder',
    PORTAL_BID_READER: 'reader-tok',
    CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/test/mbfd-bid/anthropic',
    ANTHROPIC_API_KEY: 'sk-test',
    AI_BUDGET_CAP_CENTS: 2500,
    AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AI_KV: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    AI: {} as never,
    BROWSER: {} as never,
  };
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it('returns 200 + JWT on portal success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          member_id: 555,
          employee_id: '20731',
          first_name: 'Peter',
          last_name: 'Darley',
          rank: 'LT',
          role: 'member',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: '20731', password: 'pw-secret' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: string; role: string };
    expect(body.role).toBe('member');
    expect(body.jwt.split('.').length).toBe(3);
  });

  it('returns 401 on portal 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: 'x', password: 'wrongpw' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: '', password: 'x' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(400);
  });

  // Plan 09 Task 3 — rate-limit gate.
  it('returns 429 with Retry-After when the per-IP limit is exceeded', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    // Wire a real Map-backed KV stub.
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async () => {},
      list: async () => ({ keys: [] }),
      getWithMetadata: async () => ({ value: null, metadata: null }),
    } as unknown as WorkerEnv['KV'];
    const env: WorkerEnv = { ...mkEnv(), KV: kv };

    // First 5 attempts: 401 from portal (rate limit allows them through).
    for (let i = 0; i < 5; i++) {
      const r = await app.request(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.7' },
          body: JSON.stringify({ employee_id: '20731', password: 'wrong-pw' }),
        },
        env,
      );
      expect(r.status).toBe(401);
    }

    // 6th attempt: 429 with Retry-After header.
    const blocked = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.7' },
        body: JSON.stringify({ employee_id: '20731', password: 'wrong-pw' }),
      },
      env,
    );
    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: string; scope: string };
    expect(body.error).toBe('rate_limited');
    expect(body.scope).toBe('ip');
  });
});
