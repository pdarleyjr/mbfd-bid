// Plan 09 / Rehearsal Tooling — Task R10.
// /api/admin/ai/cost?session_id=... returns the per-session running total;
// without session_id it returns the aggregate total across mock sessions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'c'.repeat(64);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'A',
      last_name: 'B',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

function aiKvStub(store: Map<string, string>): WorkerEnv['AI_KV'] {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => {
      const keys = [...store.keys()].map((k) => ({ name: k }));
      return { keys, list_complete: true, cursor: '' };
    },
  } as unknown as WorkerEnv['AI_KV'];
}

describe('GET /api/admin/ai/cost session-id filter (Task R10)', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns per-session cost when session_id is provided', async () => {
    const store = new Map<string, string>([
      ['ai_cost_cents:01HZZS001', '420'],
      ['ai_cost_cents:01HZZS002', '100'],
    ]);
    const env: WorkerEnv = { ...h.env, JWT_SIGNING_KEY: KEY, AI_KV: aiKvStub(store) };
    const res = await app.fetch(
      new Request('http://x/api/admin/ai/cost?session_id=01HZZS001', {
        method: 'GET',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cost_cents: number; cap_cents: number };
    expect(body.cost_cents).toBe(420);
  });

  it('returns aggregate running total when no session_id is provided', async () => {
    const store = new Map<string, string>([
      ['ai_cost_cents:01HZZS001', '420'],
      ['ai_cost_cents:01HZZS002', '100'],
      ['ai_cost_cents_total', '520'],
    ]);
    const env: WorkerEnv = { ...h.env, JWT_SIGNING_KEY: KEY, AI_KV: aiKvStub(store) };
    const res = await app.fetch(
      new Request('http://x/api/admin/ai/cost', {
        method: 'GET',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cost_cents: number };
    // Aggregate; either the stored total OR the sum of per-session values.
    expect(body.cost_cents).toBeGreaterThanOrEqual(520);
  });
});
