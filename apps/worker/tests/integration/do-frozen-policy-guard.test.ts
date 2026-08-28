import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SESSION_ID = '01HZZ0000000000000000DOPOL';
const CAPTURED_AT = Date.UTC(2026, 7, 27, 12, 0, 0);

interface Storage {
  data: Map<string, unknown>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
  setAlarm(when: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAll(): Promise<void>;
}

function makeStorage(): Storage {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    data,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },
    async list<T>(prefix: string): Promise<Map<string, T>> {
      return new Map([...data].filter(([key]) => key.startsWith(prefix))) as Map<string, T>;
    },
    async setAlarm(when: number): Promise<void> {
      alarm = when;
    },
    async getAlarm(): Promise<number | null> {
      return alarm;
    },
    async deleteAll(): Promise<void> {
      data.clear();
      alarm = null;
    },
  };
}

function makeStateMock(id: string, storage: Storage): DurableObjectState {
  return {
    id: { toString: () => id, equals: () => false, name: id } as unknown as DurableObjectId,
    storage: storage as unknown as DurableObjectStorage,
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    waitUntil() {},
    acceptWebSocket() {},
    getWebSockets: () => [],
    setHibernatableWebSocketEventTimeout() {},
    getHibernatableWebSocketEventTimeout: () => null,
    setWebSocketAutoResponse() {},
    getWebSocketAutoResponse: () => null,
    getWebSocketAutoResponseTimestamp: () => null,
    abort() {},
  } as unknown as DurableObjectState;
}

async function seedFrozenPolicy(h: TestD1): Promise<void> {
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    `INSERT INTO bid_sessions
       (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
     VALUES ('${SESSION_ID}', 2026, ${CAPTURED_AT}, 'config', 180, 2, 0);`,
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES
       ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter'),
       ('A211', '2026.1', 'A', '2', 'Combat', '300', 'DC', 'Division Chief');`,
  );
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
  );
  await h.db.run(
    `INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
     VALUES ('2026.2', 'A211', '2026.1', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'POL-015-test', ${CAPTURED_AT});`,
  );
  await h.db.run(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES ('2026.2', 'A101', '2026.1',
       '{"rank":["FF"],"credentials":[],"custom":[]}',
       '{"max":0,"items":[]}',
       '["points","rsc_seniority","rank_seniority"]');`,
  );
  await h.db.run("UPDATE rule_books SET status = 'active' WHERE version = '2026.2';");
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, '2026.2', '2026.1', 0, ?, ?);`,
    [
      SESSION_ID,
      JSON.stringify({
        v: 3,
        ruleBookVersion: '2026.2',
        ruleBookRevision: 0,
        positionTemplateVersion: '2026.1',
        configurationRevision: 0,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
        capturedAtMs: CAPTURED_AT,
        members: [
          {
            memberId: 42,
            pool: 'FF',
            rscSeniority: 42,
            rankSeniority: 42,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: 'FF',
            isProbationary: false,
            credentialNames: [],
          },
          {
            memberId: 43,
            pool: 'OFC',
            rscSeniority: 43,
            rankSeniority: 43,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: 'LT',
            isProbationary: false,
            credentialNames: [],
          },
          {
            memberId: 211,
            pool: 'EXCLUDED',
            rscSeniority: 1,
            rankSeniority: 1,
            exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
            authoritativeAssignmentId: 'assignment-A211',
            rank: 'DC',
            isProbationary: false,
            credentialNames: [],
          },
        ],
        ruleBookMaterial: {
          v: 1,
          rules: [
            {
              ruleBookVersion: '2026.2',
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
            {
              id: 'A211',
              templateVersion: '2026.1',
              bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
              isExcludedFromCount: false,
              shift: 'A',
              station: '2',
              unit: '300',
              rankRequired: 'DC',
              positionName: 'Division Chief',
            },
          ],
        },
      }),
      CAPTURED_AT,
    ],
  );
}

describe('BidSessionDO frozen-policy guard', () => {
  let h: TestD1;
  let storage: Storage;
  let doInstance: BidSessionDO;

  beforeEach(async () => {
    h = await setupTestD1();
    await seedFrozenPolicy(h);
    storage = makeStorage();
    doInstance = new BidSessionDO(makeStateMock(SESSION_ID, storage), {
      ...h.env,
      BID_SESSION: {} as never,
    } as WorkerEnv);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('rejects both an excluded member and an administrative position before a forced pick can mutate DO state', async () => {
    const excludedMember = await doInstance.adminForcePick({
      adminActorId: 0,
      targetMemberId: 211,
      positionId: 'A101',
      reason: 'Attempt to force excluded administrative member.',
    });
    expect(excludedMember).toMatchObject({ ok: false, error: 'member_excluded_from_bid_pool' });

    const administrativePosition = await doInstance.adminForcePick({
      adminActorId: 0,
      targetMemberId: 42,
      positionId: 'A211',
      reason: 'Attempt to force non-biddable position.',
    });
    expect(administrativePosition).toMatchObject({ ok: false, error: 'position_not_biddable' });

    const state = (await doInstance
      .fetch(new Request('https://do/snapshot'))
      .then((res) => res.json())) as BidSessionState;
    expect(state.fills).toEqual({});
    expect(state.lastSeq).toBe(0);
  });

  it('refuses to initialize a stale bid order that contains an excluded Division Chief', async () => {
    await doInstance.initSession({
      bidOrder: [{ ordinal: 1, memberId: 211, pool: 'OFC' }],
      turnTimerSeconds: 180,
    });

    const state = (await doInstance
      .fetch(new Request('https://do/snapshot'))
      .then((res) => res.json())) as BidSessionState;
    expect(state.currentPhase).toBe('config');
    expect(state.bidOrder).toEqual([]);
  });

  it('refuses a complete bid order that reorders otherwise eligible members', async () => {
    await doInstance.initSession({
      bidOrder: [
        { ordinal: 1, memberId: 42, pool: 'FF' },
        { ordinal: 2, memberId: 43, pool: 'OFC' },
      ],
      turnTimerSeconds: 180,
    });

    const state = (await doInstance
      .fetch(new Request('https://do/snapshot'))
      .then((res) => res.json())) as BidSessionState;
    expect(state.currentPhase).toBe('config');
    expect(state.bidOrder).toEqual([]);
  });

  it('refuses non-biddable positions and excluded members in A-Day phase input', async () => {
    const initial: BidSessionState = {
      ...emptyBidSessionState(SESSION_ID),
      currentPhase: 'position_bid',
      currentBidderId: 42,
      bidOrder: [{ ordinal: 1, memberId: 42, pool: 'FF' }],
    };
    await storage.put(`bs:${SESSION_ID}:state`, initial);
    doInstance = new BidSessionDO(makeStateMock(SESSION_ID, storage), {
      ...h.env,
      BID_SESSION: {} as never,
    } as WorkerEnv);

    const administrativePosition = await doInstance.transitionToPhase2({
      members: [],
      phase1Order: [42],
      phase1Picks: [{ memberId: 42, positionId: 'A211', shift: 'A' }],
    });
    expect(administrativePosition).toEqual({ ok: false });

    const excludedMember = await doInstance.transitionToPhase2({
      members: [],
      phase1Order: [211],
      phase1Picks: [{ memberId: 211, positionId: 'A211', shift: 'A' }],
    });

    expect(excludedMember).toEqual({ ok: false });
  });
});
