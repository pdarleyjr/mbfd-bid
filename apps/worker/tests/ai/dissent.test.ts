import type { KVNamespace } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordDissentIfNeeded } from '../../src/ai/dissent.js';
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

describe('recordDissentIfNeeded', () => {
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
       VALUES ('sess1', 2026, ?, 'position_bid', 180, 2, 0)`,
      [Date.now()],
    );
  });

  afterEach(async () => {
    await teardownTestD1(harness);
  });

  it('writes a dissent row when force_recommended=false and admin force-picks', async () => {
    (env.AI_KV as FakeKv).store.set(
      'ai_last_good:sess1',
      JSON.stringify({
        advisory: { ...canonical, force_recommended: false },
        generated_at_ms: Date.now(),
        ai_advisory_id: 'prev1',
      }),
    );
    await recordDissentIfNeeded(env, {
      bidSessionId: 'sess1',
      actorMemberId: 99,
      actionKind: 'forced_pick',
      targetMemberEmployeeId: '14335',
      targetPositionId: 'A101',
      reason: 'reverse seniority lock',
    });
    const { results } = await harness.db.run(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dissent'`,
    );
    expect(Number(results[0]?.n)).toBe(1);
  });

  it('does NOT write a dissent row when force_recommended=true', async () => {
    (env.AI_KV as FakeKv).store.set(
      'ai_last_good:sess1',
      JSON.stringify({
        advisory: { ...canonical, force_recommended: true, force_reasoning: 'last credentialed' },
        generated_at_ms: Date.now(),
        ai_advisory_id: 'prev1',
      }),
    );
    await recordDissentIfNeeded(env, {
      bidSessionId: 'sess1',
      actorMemberId: 99,
      actionKind: 'forced_pick',
      targetMemberEmployeeId: '14335',
      targetPositionId: 'A101',
      reason: 'last cred',
    });
    const { results } = await harness.db.run(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dissent'`,
    );
    expect(Number(results[0]?.n)).toBe(0);
  });

  it('does NOT write a dissent row when there is no recent advisory', async () => {
    await recordDissentIfNeeded(env, {
      bidSessionId: 'sessX',
      actorMemberId: 99,
      actionKind: 'forced_pick',
      targetMemberEmployeeId: '14335',
      targetPositionId: 'A101',
      reason: 'x',
    });
    const { results } = await harness.db.run(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dissent'`,
    );
    expect(Number(results[0]?.n)).toBe(0);
  });
});
