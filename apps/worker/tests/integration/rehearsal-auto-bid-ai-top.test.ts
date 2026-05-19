// W42 — auto-bid with strategy=ai_top uses the AI's recommended top_pick.
//
// The previous implementation of `getAiTopPick` always returned null, so
// `ai_top` behaved identically to `first_eligible`. This test mocks
// `AnthropicAIClient.adviseCurrent` to return a structured advisory whose
// `top_pick.position_id` is intentionally NOT the first-eligible position,
// and asserts the resulting bid row uses the AI's pick.

import type { KVNamespace } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAIClient } from '../../src/ai/client.js';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'a'.repeat(64);

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

function stubBidSessionNamespace(snapshotFor: Map<string, unknown>): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      const u = new URL(url);
      if (u.pathname.endsWith('/snapshot')) {
        const id = u.pathname.split('/')[1] ?? 'unknown';
        const snap = snapshotFor.get(id) ?? { currentBidderId: null };
        return new Response(JSON.stringify(snap), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'id' }) as unknown as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'id' }) as unknown as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

// AI_KV stub with the feature flag set so `featureEnabled` returns true and
// the gate is open.
function makeAiKv(): KVNamespace {
  const store = new Map<string, string>([['ai_advisory_enabled', 'true']]);
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

// Bare KV stub for the eligibility snapshot lookup inside loadRosterForSession.
function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

async function seedMockSession(h: TestD1, sessionId: string) {
  const now = Date.now();
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, current_bidder_id, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 201, 1);",
    [sessionId, now],
  );
  await h.db.run(
    'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (201, ?, ?, ?, ?, ?, ?, 0, ?, ?);',
    ['201201', 'AI', 'Tester', 'FF', 'FF', 100, now, now],
  );
  await h.db.run(
    "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 201, 'FF');",
    [sessionId],
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  // Three positions; the AI's top_pick is A103 (NOT A101), which the
  // first_eligible strategy would otherwise pick.
  for (const p of ['A101', 'A102', 'A103']) {
    await h.db.run(
      "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES (?, '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', ?);",
      [p, `${p} unit`],
    );
  }
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
  );
  for (const p of ['A101', 'A102', 'A103']) {
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', ?, '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
      [p],
    );
  }
}

describe('auto-bid strategy=ai_top wires getAiTopPick (W42)', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000W42AIT';
  // `vi.spyOn` on an overloaded method widens to a loose MockInstance shape
  // in strict mode. We only need the `.mockResolvedValue` /
  // `.mockRejectedValueOnce` / `.mockRestore` / `toHaveBeenCalled` surface.
  let adviseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    h = await setupTestD1();
    await seedMockSession(h, sessionId);
    adviseSpy = vi.spyOn(AnthropicAIClient.prototype, 'adviseCurrent').mockResolvedValue({
      ai_advisory_id: 'adv-W42-001',
      generated_at_ms: Date.now(),
      stale: false,
      fallback: 'none',
      advisory: {
        summary: 'Pick A103.',
        // The AI recommends A103 — NOT the first-eligible A101. Order in
        // `eligible_recommendations` is "best first", so [0] is the top pick.
        eligible_recommendations: [
          { position_id: 'A103', points: 100, why: 'AI top pick' },
          { position_id: 'A102', points: 50, why: 'alt' },
        ],
        ineligible_top_picks: [],
        forecast: { warnings: [] },
        force_recommended: false,
      },
    }) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(async () => {
    adviseSpy.mockRestore();
    await teardownTestD1(h);
  });

  it("uses the AI's top_pick.position_id (A103) instead of first_eligible (A101)", async () => {
    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: 201 }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
      AI_KV: makeAiKv(),
      KV: makeKv(),
    };

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 1, strategy: 'ai_top' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picksMade: number };
    expect(body.picksMade).toBe(1);
    expect(adviseSpy).toHaveBeenCalled();

    const bidsRows = await h.db.run('SELECT position_id FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect(bidsRows.results).toHaveLength(1);
    expect((bidsRows.results[0] as { position_id: string }).position_id).toBe('A103');
  });

  it('falls back to first_eligible when the AI call throws', async () => {
    adviseSpy.mockRejectedValueOnce(new Error('upstream down'));
    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: 201 }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
      AI_KV: makeAiKv(),
      KV: makeKv(),
    };
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 1, strategy: 'ai_top' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picksMade: number };
    expect(body.picksMade).toBe(1);
    const bidsRows = await h.db.run('SELECT position_id FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    // A101 is the first eligible position when AI is unavailable.
    expect((bidsRows.results[0] as { position_id: string }).position_id).toBe('A101');
  });
});
