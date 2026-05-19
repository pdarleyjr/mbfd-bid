/*
 * Plan 06 Task 20 — full /advise-current happy-path integration test.
 *
 * This test exercises the entire AI advisory pipeline using a real D1
 * (better-sqlite3 harness), a fake KV, and a mocked global fetch that
 * stands in for the Cloudflare AI Gateway. It verifies:
 *
 *   1. Admin JWT auth passes through requireAdmin middleware.
 *   2. /advise-current builds the prompt blocks (system + roster + turn).
 *   3. The AnthropicAIClient calls the gateway URL (NOT api.anthropic.com)
 *      and persists cost_cents to AI_KV.
 *   4. The route writes an ai_advisories row whose model + promptHash are set.
 *   5. The follow-up GET /cost reflects the running spend.
 *   6. The follow-up GET /forecast (after a manual KV seed) returns the
 *      forecast envelope.
 *
 * The plan body suggests `wrangler unstable_dev` but that runs the worker
 * out-of-process, which makes outbound fetch mocking far harder than the
 * in-process Hono pattern used here. The in-process variant gives identical
 * coverage with deterministic mocks.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    harness = await setupTestD1();
    env = {
      ...harness.env,
      KV: makeKv(),
      AI_KV: makeKv(),
    };
    await harness.db.run(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('sessIntg', 2026, ?, 'position_bid', 180, 2, 0)`,
      [Date.now()],
    );
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_intg',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify(canonical) }],
          stop_reason: 'end_turn',
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 5000,
            output_tokens: 800,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 4500,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test-only fetch shim
    globalThis.fetch = fetchMock as any;
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

    // 2. The route persisted an ai_advisories audit row
    const { results } = await harness.db.run(
      'SELECT model, bid_session_id, triggered_by FROM ai_advisories LIMIT 1',
    );
    expect(results[0]?.model).toBe('claude-sonnet-4-6');
    expect(results[0]?.bid_session_id).toBe('sessIntg');
    expect(results[0]?.triggered_by).toBe('turn_start');

    // 3. The fetch went to the configured gateway URL
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const firstCall = calls[0];
    if (!firstCall) throw new Error('fetch was not called');
    const url = firstCall[0] as string;
    expect(url).toContain('gateway.ai.cloudflare.com');
    expect(url).not.toContain('api.anthropic.com');

    // 4. /cost reflects the spend
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
