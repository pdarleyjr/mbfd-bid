import type { KVNamespace } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmCacheForOnDeck } from '../../src/ai/cache-warm.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from '../integration/helpers/test-d1.js';
import canonical from './__fixtures__/advisory-canonical.json';

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

describe('warmCacheForOnDeck', () => {
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
    await harness.db.run(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('sess1', 2026, ?, 'config', 180, 2, 0)`,
      [Date.now()],
    );
  });

  afterEach(async () => {
    await teardownTestD1(harness);
  });

  it('writes last_good for the session when called', async () => {
    await warmCacheForOnDeck(env, 'sess1', '14335');
    expect((env.AI_KV as FakeKv).store.has('ai_last_good:sess1')).toBe(true);
  });

  it('is a no-op when feature flag off', async () => {
    (env.AI_KV as FakeKv).store.set('ai_advisory_enabled', 'false');
    const aiRun = vi.fn();
    env.AI = { run: aiRun } as unknown as Ai;
    await warmCacheForOnDeck(env, 'sess1', '14335');
    expect(aiRun).not.toHaveBeenCalled();
  });
});
