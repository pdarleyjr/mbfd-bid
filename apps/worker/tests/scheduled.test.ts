import type { KVNamespace } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleScheduled } from '../src/scheduled.js';
import type { WorkerEnv } from '../src/types/env.js';
import canonical from './ai/__fixtures__/advisory-canonical.json';
import { type TestD1, setupTestD1, teardownTestD1 } from './integration/helpers/test-d1.js';

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

describe('handleScheduled', () => {
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
  });

  afterEach(async () => {
    await teardownTestD1(harness);
  });

  it('refreshes ai_forecast:<session_id> for each live session', async () => {
    await harness.db.run(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('sess1', 2026, ?, 'position_bid', 180, 2, 0)`,
      [Date.now()],
    );
    await handleScheduled(env);
    expect((env.AI_KV as FakeKv).store.has('ai_forecast:sess1')).toBe(true);
  });

  it('is a no-op when no live sessions', async () => {
    const aiRun = vi.fn();
    env.AI = { run: aiRun } as unknown as Ai;
    await handleScheduled(env);
    expect(aiRun).not.toHaveBeenCalled();
  });
});
