import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'i'.repeat(64);
const MEMBER_ID = 60;
const REAL_SESSION = '01HZZ0000000000000LIVEISO1';
const OLDER_REAL_SESSION = '01HZZ0000000000000LIVEISO2';
const MOCK_SESSION = '01HZZ0000000000000MOCKISO1';
const COMPLETE_REAL_SESSION = '01HZZ0000000000000DONEISO1';

async function memberJwt(): Promise<string> {
  return signJwt(
    {
      sub: MEMBER_ID,
      emp: '60060',
      role: 'member',
      rank: 'FF',
      first_name: 'Session',
      last_name: 'Viewer',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
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
              currentBidderId: MEMBER_ID,
              turnStartedAtMs: 1,
              turnTimerSeconds: 180,
              lastSeq: 0,
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

function frozenPolicySnapshot(capturedAtMs: number) {
  return {
    v: 3,
    ruleBookVersion: '2026.1',
    ruleBookRevision: 0,
    positionTemplateVersion: '2026.1',
    configurationRevision: 0,
    settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
    capturedAtMs,
    members: [
      {
        memberId: MEMBER_ID,
        pool: 'FF',
        rscSeniority: 1,
        rankSeniority: null,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
      },
    ],
    operatorIdentityProjection: [
      {
        memberId: MEMBER_ID,
        employeeId: '60060',
        firstName: 'Session',
        lastName: 'Viewer',
        rank: 'FF',
      },
    ],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: '2026.1',
          positionId: 'A101',
          templateVersion: '2026.1',
          requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
        },
      ],
      positions: [
        {
          id: 'A101',
          templateVersion: '2026.1',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '1',
          unit: 'Engine 1',
          rankRequired: 'FF',
          positionName: 'Firefighter',
        },
      ],
    },
  };
}

async function seedSession(
  h: TestD1,
  options: {
    id: string;
    startedAt: number;
    isMock: boolean;
    canonicalPhase?: 'complete' | 'position_bid';
  },
): Promise<void> {
  await h.db.run(
    `INSERT INTO bid_sessions (
       id, bid_year, started_at, current_phase, current_bidder_id,
       turn_timer_seconds, expected_duration_days, day_count, is_mock
     ) VALUES (?, 2026, ?, 'position_bid', ?, 180, 2, 0, ?);`,
    [options.id, options.startedAt, MEMBER_ID, options.isMock ? 1 : 0],
  );
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots (
       bid_session_id, rule_book_version, position_template_version,
       rule_book_revision, snapshot_json, captured_at
     ) VALUES (?, '2026.1', '2026.1', 0, ?, ?);`,
    [options.id, JSON.stringify(frozenPolicySnapshot(options.startedAt)), options.startedAt],
  );
  if (options.canonicalPhase !== undefined) {
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
         bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
       ) VALUES (?, 1, ?, 'canonical-session-isolation', ?, ?);`,
      [
        options.id,
        JSON.stringify({
          bidSessionId: options.id,
          currentPhase: options.canonicalPhase,
          currentBidderId: options.canonicalPhase === 'complete' ? null : MEMBER_ID,
          turnStartedAtMs: 1,
          turnTimerSeconds: 180,
          lastSeq: 1,
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: null,
          aDay: null,
        }),
        options.startedAt,
        options.startedAt,
      ],
    );
  }
}

async function get(h: TestD1, path: string): Promise<Response> {
  return app.fetch(
    new Request(`http://x${path}`, {
      headers: { Authorization: `Bearer ${await memberJwt()}` },
    }),
    {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: sessionAwareBidSessionNamespace(),
    },
  );
}

describe('implicit Live Bid session isolation', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (60, '60060', 'Session', 'Viewer', 'FF', 'FF', 1, 0, 1, 1);",
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');`,
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'A101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('selects the older unfinished real Bid across every implicit general surface when a newer Mock exists', async () => {
    await seedSession(h, { id: REAL_SESSION, startedAt: 1, isMock: false });
    await seedSession(h, { id: MOCK_SESSION, startedAt: 2, isMock: true });

    const board = await get(h, '/api/board');
    expect(board.status).toBe(200);
    await expect(board.json()).resolves.toMatchObject({
      bidSessionId: REAL_SESSION,
      isMock: false,
    });

    const presentation = await get(h, '/api/presentation');
    expect(presentation.status).toBe(200);
    await expect(presentation.json()).resolves.toEqual({
      mode: 'OFF',
      session: { id: REAL_SESSION, bid_year: 2026 },
    });

    const eligibility = await get(h, '/api/me/eligibility');
    expect(eligibility.status).toBe(200);
    await expect(eligibility.json()).resolves.toMatchObject({
      memberId: MEMBER_ID,
      rule_book_version: '2026.1',
    });

    const state = await get(h, '/api/bid/state');
    expect(state.status).toBe(200);
    await expect(state.json()).resolves.toMatchObject({
      state: { bidSessionId: REAL_SESSION },
    });
  });

  it('returns each established no-active-session response when unfinished Mocks are the only sessions', async () => {
    await seedSession(h, { id: MOCK_SESSION, startedAt: 1, isMock: true });

    const board = await get(h, '/api/board');
    expect(board.status).toBe(404);
    await expect(board.json()).resolves.toEqual({ error: 'no_active_session' });

    const presentation = await get(h, '/api/presentation');
    expect(presentation.status).toBe(200);
    await expect(presentation.json()).resolves.toEqual({ mode: 'OFF', session: null });

    const eligibility = await get(h, '/api/me/eligibility');
    expect(eligibility.status).toBe(404);
    await expect(eligibility.json()).resolves.toEqual({ error: 'no_active_session' });

    const state = await get(h, '/api/bid/state');
    expect(state.status).toBe(404);
    await expect(state.json()).resolves.toEqual({ error: 'no_active_session' });
  });

  it('preserves explicit access to a Mock session', async () => {
    await seedSession(h, { id: MOCK_SESSION, startedAt: 1, isMock: true });

    const board = await get(h, `/api/board?bidSessionId=${MOCK_SESSION}`);
    expect(board.status).toBe(200);
    await expect(board.json()).resolves.toMatchObject({
      bidSessionId: MOCK_SESSION,
      isMock: true,
    });
  });

  it('uses canonical completion over stale persisted phase and continues to an older unfinished real Bid', async () => {
    await seedSession(h, { id: OLDER_REAL_SESSION, startedAt: 1, isMock: false });
    await seedSession(h, {
      id: COMPLETE_REAL_SESSION,
      startedAt: 2,
      isMock: false,
      canonicalPhase: 'complete',
    });

    const board = await get(h, '/api/board');
    expect(board.status).toBe(200);
    await expect(board.json()).resolves.toMatchObject({
      bidSessionId: OLDER_REAL_SESSION,
      isMock: false,
    });
  });

  it('reports no active Live session when every real session is canonically complete', async () => {
    await seedSession(h, {
      id: COMPLETE_REAL_SESSION,
      startedAt: 1,
      isMock: false,
      canonicalPhase: 'complete',
    });
    await seedSession(h, { id: MOCK_SESSION, startedAt: 2, isMock: true });

    const board = await get(h, '/api/board');
    expect(board.status).toBe(404);
    await expect(board.json()).resolves.toEqual({ error: 'no_active_session' });
  });
});
