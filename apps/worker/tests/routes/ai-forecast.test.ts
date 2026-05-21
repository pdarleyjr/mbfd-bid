import type { KVNamespace } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import adminAi from '../../src/routes/ai.js';
import type { WorkerEnv } from '../../src/types/env.js';
import canonical from '../ai/__fixtures__/advisory-canonical.json';

type FakeKv = KVNamespace & { store: Map<string, string> };

function makeKv(): FakeKv {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as FakeKv;
}

function makeEnv(): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'a'.repeat(64),
    PIN_HASH: 'x',
    PORTAL_BID_READER: 'tok',
    CF_AI_GATEWAY_URL: 'https://gateway.example.com/v1/x/mbfd-bid/anthropic',
    AI_BUDGET_CAP_CENTS: 2500,
    AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    DB: {} as never,
    KV: makeKv(),
    BID_SESSION: {} as never,
    AI_KV: makeKv(),
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

async function adminJwt(env: WorkerEnv): Promise<string> {
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

function mkApp() {
  return new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/ai', adminAi);
}

describe('GET /api/admin/ai/forecast', () => {
  let env: WorkerEnv;
  beforeEach(() => {
    env = makeEnv();
  });

  it('returns the cached forecast envelope', async () => {
    (env.AI_KV as FakeKv).store.set(
      'ai_forecast:s1',
      JSON.stringify({
        advisory: canonical,
        stale: false,
        fallback: 'none',
        generated_at_ms: Date.now(),
        ai_advisory_id: 'x',
      }),
    );
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/forecast?session_id=s1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { advisory: { summary: string } };
    expect(body.advisory.summary).toBeDefined();
  });

  it('returns 404 when no forecast cached', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/forecast?session_id=missing',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 without session_id', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/forecast',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(400);
  });
});
