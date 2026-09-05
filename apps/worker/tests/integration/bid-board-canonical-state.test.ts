import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { canonicalOrderUsesFrozenMembership } from '../../src/routes/bid.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'm'.repeat(64);
const SESSION_ID = '01HZZ0000000000000BOARDCAN';

describe('canonical board order validation', () => {
  const frozen = [
    { ordinal: 1, memberId: 10, pool: 'OFC' as const },
    { ordinal: 2, memberId: 20, pool: 'FF' as const },
    { ordinal: 3, memberId: 30, pool: 'FF' as const },
  ] as const;

  it('accepts an authorized canonical reorder or consumed-member subset', () => {
    expect(canonicalOrderUsesFrozenMembership([frozen[1], frozen[0], frozen[2]], frozen)).toBe(
      true,
    );
    expect(canonicalOrderUsesFrozenMembership([frozen[1], frozen[2]], frozen)).toBe(true);
  });

  it('rejects duplicates, unknown members, or changed frozen metadata', () => {
    expect(canonicalOrderUsesFrozenMembership([frozen[0], frozen[0]], frozen)).toBe(false);
    expect(
      canonicalOrderUsesFrozenMembership(
        [{ ordinal: 4, memberId: 40, pool: 'FF' as const }],
        frozen,
      ),
    ).toBe(false);
    expect(
      canonicalOrderUsesFrozenMembership(
        [{ ordinal: 99, memberId: 20, pool: 'FF' as const }],
        frozen,
      ),
    ).toBe(false);
  });
});

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

async function memberJwt(): Promise<string> {
  return signJwt(
    {
      sub: 77,
      emp: '770077',
      role: 'member',
      rank: 'FF',
      first_name: 'Member',
      last_name: 'Viewer',
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
      ) VALUES
        (77, '770077', 'Canonical', 'Member', 'FF', 'FF', 1, 0, 1, 1),
        (78, '770078', 'Mutable', 'Roster', 'DC', 'OFC', 0, 0, 1, 1);`,
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
    await h.db.run(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, current_bidder_id,
        turn_timer_seconds, expected_duration_days, day_count, is_mock
      ) VALUES (?, 2026, 1, 'position_bid', 77, 180, 2, 0, 1);`,
      [SESSION_ID],
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, '2026.1', '2026.1', 0, ?, 1);`,
      [
        SESSION_ID,
        JSON.stringify({
          v: 3,
          ruleBookVersion: '2026.1',
          ruleBookRevision: 0,
          positionTemplateVersion: '2026.1',
          configurationRevision: 0,
          settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
          capturedAtMs: 1,
          members: [
            {
              memberId: 77,
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
              memberId: 77,
              employeeId: '770077',
              firstName: 'Canonical',
              lastName: 'Member',
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
        }),
      ],
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

  it('retains the existing authenticated-board boundary for unauthenticated requests', async () => {
    const res = await app.fetch(new Request(`http://x/api/board?bidSessionId=${SESSION_ID}`), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_auth' });
  });

  it('does not label a canonical paused session as an unstarted preview when it restores its frozen order', async () => {
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
      bidOrder: [{ ordinal: 1, memberId: 77, pool: 'FF' }],
      bidOrderPreview: false,
      advisory: {
        v: 1,
        determinationSource: 'authoritative_bid_state',
        sessionId: SESSION_ID,
        sequence: 8,
        cards: expect.arrayContaining([
          expect.objectContaining({ kind: 'bid_state', severity: 'attention' }),
          expect.objectContaining({ kind: 'position_options' }),
          expect.objectContaining({ kind: 'mock_boundary' }),
        ]),
      },
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

  it('returns the freeze-bound identity projection to an authorized operator, not the mutable directory', async () => {
    await h.db.run("UPDATE members SET first_name = 'Changed', last_name = 'Today' WHERE id = 77;");

    const res = await app.fetch(
      new Request(`http://x/api/board?bidSessionId=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await jwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace() },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      members: {
        '77': { firstName: 'Canonical', lastName: 'Member', employeeId: '770077' },
      },
    });
  });

  it('does not expose the operator identity projection to a member', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/board?bidSessionId=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: stubBidSessionNamespace() },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      bidSessionId: SESSION_ID,
      currentPhase: 'paused',
      lastSeq: 8,
      bidOrder: [{ ordinal: 1, memberId: 77, pool: 'FF' }],
      positions: [expect.objectContaining({ id: 'A101', bidParticipation: 'BIDDABLE' })],
      members: {
        '77': { firstName: 'Member', lastName: '#77', employeeId: '#77' },
      },
    });
    expect(body.advisory).toBeUndefined();
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
