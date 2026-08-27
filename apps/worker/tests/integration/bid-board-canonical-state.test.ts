import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'm'.repeat(64);
const SESSION_ID = '01HZZ0000000000000BOARDCAN';

function stubBidSessionNamespace(): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async () =>
      new Response(
        JSON.stringify({
          bidSessionId: SESSION_ID,
          currentPhase: 'position_bid',
          currentBidderId: 77,
          turnStartedAtMs: 1,
          turnTimerSeconds: 180,
          lastSeq: 7,
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: null,
          aDay: null,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

function sessionAwareBidSessionNamespace(): WorkerEnv['BID_SESSION'] {
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) =>
      ({
        fetch: async () =>
          new Response(
            JSON.stringify({
              bidSessionId: id.toString(),
              currentPhase: 'position_bid',
              currentBidderId: 77,
              turnStartedAtMs: 1,
              turnTimerSeconds: 180,
              lastSeq: 7,
              fills: {},
              bidOrder: [],
              queueCursor: 0,
              frozenAt: null,
              aDay: null,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      }) as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

async function jwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Test',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('GET /api/board canonical mock state', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      `INSERT INTO members (
        id, employee_id, first_name, last_name, rank, bid_category,
        rsc_seniority, is_probationary, created_at, updated_at
      ) VALUES (77, '770077', 'Canonical', 'Member', 'FF', 'FF', 1, 0, 1, 1);`,
    );
    await h.db.run(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, current_bidder_id,
        turn_timer_seconds, expected_duration_days, day_count, is_mock
      ) VALUES (?, 2026, 1, 'position_bid', 77, 180, 2, 0, 1);`,
      [SESSION_ID],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 8, ?, 'canonical-freeze-001', 1, 1);`,
      [
        SESSION_ID,
        JSON.stringify({
          bidSessionId: SESSION_ID,
          currentPhase: 'paused',
          currentBidderId: null,
          turnStartedAtMs: 1,
          turnTimerSeconds: 180,
          lastSeq: 8,
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: 1,
          aDay: null,
        }),
      ],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('does not let stale legacy session fields override an authoritative canonical freeze', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/board?bidSessionId=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await jwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace() },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      bidSessionId: SESSION_ID,
      currentPhase: 'paused',
      currentBidderId: null,
      lastSeq: 8,
      frozenAt: 1,
    });
  });

  it('selects the canonical non-complete session when no query is supplied', async () => {
    const newerCompleteId = '01HZZ0000000000000BOARDNEW';
    await h.db.run(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock
      ) VALUES (?, 2026, 2, 'position_bid', 180, 2, 0, 1);`,
      [newerCompleteId],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'complete-command', 2, 2);`,
      [
        newerCompleteId,
        JSON.stringify({
          bidSessionId: newerCompleteId,
          currentPhase: 'complete',
          currentBidderId: null,
          turnStartedAtMs: 1,
          turnTimerSeconds: 180,
          lastSeq: 1,
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: null,
          aDay: null,
        }),
      ],
    );

    const res = await app.fetch(
      new Request('http://x/api/board', {
        headers: { Authorization: `Bearer ${await jwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: sessionAwareBidSessionNamespace() },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      bidSessionId: SESSION_ID,
      currentPhase: 'paused',
      lastSeq: 8,
    });
  });

  it('fails closed when an identity-bound canonical row lacks a complete session projection', async () => {
    const malformedId = '01HZZ0000000000000BOARDMAL';
    await h.db.run(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock
      ) VALUES (?, 2026, 3, 'position_bid', 180, 2, 0, 1);`,
      [malformedId],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 0, ?, NULL, 3, 3);`,
      [malformedId, JSON.stringify({ bidSessionId: malformedId, lastSeq: 0 })],
    );

    const res = await app.fetch(
      new Request(`http://x/api/board?bidSessionId=${malformedId}`, {
        headers: { Authorization: `Bearer ${await jwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace() },
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'canonical_state_unavailable' });
  });
});
