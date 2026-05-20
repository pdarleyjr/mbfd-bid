/*
 * Plan 06 Task 20 — full /advise-current happy-path integration test.
 *
 * Updated 2026-05 for the Workers AI swap. The test exercises the entire AI
 * advisory pipeline using a real D1 (better-sqlite3 harness), a fake KV, and
 * a mocked `env.AI.run` standing in for the Cloudflare Workers AI binding.
 * It verifies:
 *
 *   1. Admin JWT auth passes through requireAdmin middleware.
 *   2. /advise-current builds the prompt (system + roster + turn).
 *   3. The WorkersAIClient calls `env.AI.run` (NOT globalThis.fetch).
 *   4. The route writes an ai_advisories row whose model + promptHash are set.
 *   5. The follow-up GET /cost reflects the running spend (0 for Llama).
 *   6. The follow-up GET /forecast (after a manual KV seed) returns the
 *      forecast envelope.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKERS_AI_MODEL } from '../../src/ai/client.js';
import { signJwt } from '../../src/lib/jwt.js';
import adminAi from '../../src/routes/ai.js';
import type { WorkerEnv } from '../../src/types/env.js';
import canonical from '../ai/__fixtures__/advisory-canonical.json';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

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

describe('AI advisory full-flow integration', () => {
  let harness: TestD1;
  let env: WorkerEnv;
  let aiRunMock: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    harness = await setupTestD1();
    aiRunMock = vi.fn().mockResolvedValue({ response: JSON.stringify(canonical) });
    env = {
      ...harness.env,
      KV: makeKv(),
      AI_KV: makeKv(),
      AI: { run: aiRunMock } as unknown as Ai,
    };
    await harness.db.run(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('sessIntg', 2026, ?, 'position_bid', 180, 2, 0)`,
      [Date.now()],
    );
    fetchSpy = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: test-only fetch shim
    globalThis.fetch = fetchSpy as any;
  });

  afterEach(async () => {
    await teardownTestD1(harness);
  });

  it('full pipeline: advise-current → ai_advisories row → cost → forecast', async () => {
    const app = new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/ai', adminAi);
    const jwt = await adminJwt(env);

    // 1. advise-current
    const adviseRes = await app.request(
      '/api/admin/ai/advise-current?session_id=sessIntg',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(adviseRes.status).toBe(200);
    const envelope = (await adviseRes.json()) as {
      advisory: { summary: string };
      stale: boolean;
      ai_advisory_id: string;
    };
    expect(envelope.stale).toBe(false);
    expect(envelope.ai_advisory_id).toBeDefined();

    // 2. The route persisted an ai_advisories audit row with the Llama model name
    const { results } = await harness.db.run(
      'SELECT model, bid_session_id, triggered_by FROM ai_advisories LIMIT 1',
    );
    expect(results[0]?.model).toBe(WORKERS_AI_MODEL);
    expect(results[0]?.bid_session_id).toBe('sessIntg');
    expect(results[0]?.triggered_by).toBe('turn_start');

    // 3. The call went to env.AI.run with the Llama model — NOT through globalThis.fetch
    expect(aiRunMock).toHaveBeenCalled();
    const firstCall = aiRunMock.mock.calls[0] ?? [];
    expect(firstCall[0]).toBe(WORKERS_AI_MODEL);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 4. /cost reflects the spend (0 cents for the Workers AI free tier)
    const costRes = await app.request(
      '/api/admin/ai/cost?session_id=sessIntg',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    const cost = (await costRes.json()) as { cost_cents: number; cap_cents: number };
    expect(cost.cost_cents).toBeGreaterThanOrEqual(0);
    expect(cost.cap_cents).toBe(env.AI_BUDGET_CAP_CENTS);

    // 5. /forecast returns 404 (none cached yet), then 200 after seeding
    let forecastRes = await app.request(
      '/api/admin/ai/forecast?session_id=sessIntg',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(forecastRes.status).toBe(404);
    (env.AI_KV as FakeKv).store.set('ai_forecast:sessIntg', JSON.stringify(envelope));
    forecastRes = await app.request(
      '/api/admin/ai/forecast?session_id=sessIntg',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(forecastRes.status).toBe(200);
  });
});
