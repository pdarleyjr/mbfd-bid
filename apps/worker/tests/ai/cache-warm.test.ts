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

describe('warmCacheForOnDeck', () => {
  let harness: TestD1;
  let env: WorkerEnv;

  beforeEach(async () => {
    harness = await setupTestD1();
    env = {
      ...harness.env,
      KV: makeKv(),
      AI_KV: makeKv(),
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
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'm',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify(canonical) }],
          stop_reason: 'end_turn',
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      // biome-ignore lint/suspicious/noExplicitAny: test-only fetch shim
    ) as any;
    await warmCacheForOnDeck(env, 'sess1', '14335');
    expect((env.AI_KV as FakeKv).store.has('ai_last_good:sess1')).toBe(true);
  });

  it('is a no-op when feature flag off', async () => {
    (env.AI_KV as FakeKv).store.set('ai_advisory_enabled', 'false');
    const fetchSpy = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: test-only fetch shim
    globalThis.fetch = fetchSpy as any;
    await warmCacheForOnDeck(env, 'sess1', '14335');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
