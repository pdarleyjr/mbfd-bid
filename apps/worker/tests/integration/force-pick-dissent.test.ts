// W28 — Verify the admin force-pick route calls recordDissentIfNeeded and
// produces a `dissent` audit row when the AI's last advisory disagrees with
// the admin's pick.
//
// Setup: cache a fake advisory in AI_KV with `force_recommended: false`,
// force-pick a member, then assert that one `dissent` row exists.

import type { KVNamespace } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'd'.repeat(64);

async function freshAdmin(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'B',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

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

// Minimum-viable Advisory fixture: the dissent check only reads
// `force_recommended`. Other fields are required by the type but don't
// affect the dissent decision.
const advisoryFalseForce = {
  rule_book_version: '2026.1',
  policy_block: { hard_excluded: [], soft_preferred: [], tie_break: [] },
  top_pick: { position_id: 'A205', score: 1, rationale: ['ok'] },
  alt_picks: [],
  force_recommended: false,
  force_reasoning: null,
};

describe('POST /api/admin/bid-session/:id/force-pick — dissent recording (W28)', () => {
  let h: TestD1;
  let aiKv: FakeKv;
  const sessionId = '01HZZ0000000000000000DISS01';

  beforeEach(async () => {
    h = await setupTestD1();
    aiKv = makeKv();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (42, '12345', 'Force', 'Test', 'FF', 'FF', 200, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 42, 'FF');",
      [sessionId],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('writes a dissent row when the cached advisory disagrees with the force-pick', async () => {
    aiKv.store.set(
      `ai_last_good:${sessionId}`,
      JSON.stringify({
        advisory: advisoryFalseForce,
        generated_at_ms: Date.now(),
        ai_advisory_id: 'prev-ulid-001',
      }),
    );

    const env: WorkerEnv = { ...h.env, AI_KV: aiKv, JWT_SIGNING_KEY: KEY };
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Minimum Paramedic staffing on A-shift Rescue.',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);

    const audit = await h.db.run(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dissent' AND bid_session_id = ?`,
      [sessionId],
    );
    expect(Number(audit.results[0]?.n)).toBe(1);
  });

  it('does NOT write a dissent row when the advisory also recommends force', async () => {
    aiKv.store.set(
      `ai_last_good:${sessionId}`,
      JSON.stringify({
        advisory: { ...advisoryFalseForce, force_recommended: true, force_reasoning: 'last cred' },
        generated_at_ms: Date.now(),
        ai_advisory_id: 'prev-ulid-002',
      }),
    );

    const env: WorkerEnv = { ...h.env, AI_KV: aiKv, JWT_SIGNING_KEY: KEY };
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Minimum Paramedic staffing on A-shift Rescue.',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);

    const audit = await h.db.run(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dissent' AND bid_session_id = ?`,
      [sessionId],
    );
    expect(Number(audit.results[0]?.n)).toBe(0);
  });

  it('does NOT write a dissent row when no advisory is cached', async () => {
    const env: WorkerEnv = { ...h.env, AI_KV: aiKv, JWT_SIGNING_KEY: KEY };
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Minimum Paramedic staffing on A-shift Rescue.',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);

    const audit = await h.db.run(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dissent' AND bid_session_id = ?`,
      [sessionId],
    );
    expect(Number(audit.results[0]?.n)).toBe(0);
  });
});
