import type { KVNamespace } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import adminAi from '../../src/routes/ai.js';
import type { WorkerEnv } from '../../src/types/env.js';
import canonical from '../ai/__fixtures__/advisory-canonical.json';
import { type TestD1, setupTestD1, teardownTestD1 } from '../integration/helpers/test-d1.js';

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

function makeAi(response: unknown): Ai {
  return { run: vi.fn().mockResolvedValue(response) } as unknown as Ai;
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

async function memberJwt(env: WorkerEnv): Promise<string> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: 1,
    emp: '14335',
    role: 'member',
    rank: 'FF',
    first_name: 'M',
    last_name: 'B',
    fresh_auth_at: Math.floor(Date.now() / 1000),
  };
  return signJwt(payload, env.JWT_SIGNING_KEY);
}

function mkApp() {
  return new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/ai', adminAi);
}

describe('GET /api/admin/ai/advise-current', () => {
  let harness: TestD1;
  let env: WorkerEnv;

  beforeEach(async () => {
    harness = await setupTestD1();
    env = {
      ...harness.env,
      KV: makeKv(),
      AI_KV: makeKv(),
      AI: makeAi({ response: JSON.stringify(canonical) }),
    };
    // seed a bid_session so the optional FK has a target if FKs were on
    await harness.db.run(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('sess1', 2026, ?, 'config', 180, 2, 0)`,
      [Date.now()],
    );
  });

  afterEach(async () => {
    await teardownTestD1(harness);
  });

  it('returns 401 without auth', async () => {
    const res = await mkApp().request('/api/admin/ai/advise-current?session_id=sess1', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns 403 for member role', async () => {
    const jwt = await memberJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/advise-current?session_id=sess1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 503 when feature flag off', async () => {
    (env.AI_KV as FakeKv).store.set('ai_advisory_enabled', 'false');
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/advise-current?session_id=sess1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { disabled: boolean }).disabled).toBe(true);
  });

  it('happy path returns AdvisoryEnvelope JSON', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/advise-current?session_id=sess1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { advisory: { summary: string }; stale: boolean };
    expect(body.advisory.summary).toBeDefined();
    expect(body.stale).toBe(false);
  });

  it('completes in <2500ms (synthetic — env.AI.run mocked at 0ms)', async () => {
    const jwt = await adminJwt(env);
    const t0 = performance.now();
    await mkApp().request(
      '/api/admin/ai/advise-current?session_id=sess1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(performance.now() - t0).toBeLessThan(2500);
  });

  it('emits ai_advisories audit row', async () => {
    const jwt = await adminJwt(env);
    await mkApp().request(
      '/api/admin/ai/advise-current?session_id=sess1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    const { results } = await harness.db.run('SELECT COUNT(*) AS n FROM ai_advisories');
    expect(Number(results[0]?.n)).toBeGreaterThan(0);
  });

  it('returns 400 without session_id', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/advise-current',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(400);
  });
});
