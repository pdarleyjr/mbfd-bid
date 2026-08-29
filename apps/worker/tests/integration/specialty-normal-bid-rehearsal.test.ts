import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type BidSessionState,
  bidSessionStateStorageKey,
} from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';
import specialtyAdjudication from '../../src/routes/admin/specialty-adjudication.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'r'.repeat(64);
const SESSION_ID = '01HZZ0000000000000SPECREHEARSE';
const CAPTURED_AT = Date.UTC(2026, 7, 28, 12, 0, 0);

class MemoryDurableStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof key === 'string') {
      this.values.set(key, value);
      return;
    }
    for (const [entryKey, entryValue] of Object.entries(key)) this.values.set(entryKey, entryValue);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    return new Map(
      [...this.values.entries()].filter(
        ([key]) => options.prefix === undefined || key.startsWith(options.prefix),
      ),
    ) as Map<string, T>;
  }

  async transaction<T>(closure: (transaction: MemoryDurableStorage) => Promise<T>): Promise<T> {
    return closure(this);
  }
}

function makeState(storage: MemoryDurableStorage): DurableObjectState {
  return {
    id: { name: SESSION_ID, toString: () => SESSION_ID } as DurableObjectId,
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async <T>(closure: () => Promise<T>) => closure(),
    waitUntil: () => undefined,
  } as unknown as DurableObjectState;
}

function normalBidState(): BidSessionState {
  return {
    bidSessionId: SESSION_ID,
    currentPhase: 'position_bid',
    currentBidderId: 17,
    turnStartedAtMs: CAPTURED_AT,
    turnTimerSeconds: 180,
    lastSeq: 8,
    fills: {},
    bidOrder: [{ ordinal: 42, memberId: 17, pool: 'FF' }],
    queueCursor: 0,
    frozenAt: null,
    aDay: null,
  };
}

async function freshAdmin(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

function syntheticPolicy() {
  return {
    source: 'synthetic',
    policy_reference: 'synthetic-specialty-rehearsal-v1',
    test_policy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-specialty-rehearsal-v1',
      specialty_pool: { id: 'MARINE_TEST_POOL', label: 'Marine Operations synthetic test pool' },
      qualification_requirements: ['Marine Operations'],
      ranking: {
        source: 'EXPLICIT_TEST_PRIORITY',
        reference: 'synthetic-marine-priority-v1',
      },
      tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
      normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
      candidate_outcomes: ['award', 'declined', 'unavailable'],
      original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
    },
    candidate_release_policy: {
      status: 'configured',
      on_release: 'continue_to_next_higher_priority',
    },
    // The original normal bidder (17) ranks below the three specialty candidates.
    candidates: [
      {
        member_id: 11,
        priority_rank: 1,
        general_eligibility: { status: 'eligible' },
        specialty_eligibility: { status: 'eligible' },
      },
      {
        member_id: 12,
        priority_rank: 2,
        general_eligibility: { status: 'eligible' },
        specialty_eligibility: { status: 'eligible' },
      },
      {
        member_id: 13,
        priority_rank: 3,
        general_eligibility: { status: 'eligible' },
        specialty_eligibility: { status: 'eligible' },
      },
      {
        member_id: 17,
        priority_rank: 4,
        general_eligibility: { status: 'eligible' },
        specialty_eligibility: { status: 'eligible' },
      },
    ],
  };
}

function namespaceFor(instance: () => BidSessionDO): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string, init?: RequestInit) =>
      instance().fetch(typeof input === 'string' ? new Request(input, init) : input),
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => SESSION_ID }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => SESSION_ID }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

async function routeRequest(
  h: TestD1,
  instance: () => BidSessionDO,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await freshAdmin()}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  return specialtyAdjudication.fetch(new Request(`http://x${path}`, { ...init, headers }), {
    ...h.env,
    JWT_SIGNING_KEY: KEY,
    BID_SESSION: namespaceFor(instance),
  });
}

async function directNormalBidRequest(
  h: TestD1,
  instance: () => BidSessionDO,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await freshAdmin()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: namespaceFor(instance),
    },
  );
}

async function seed(h: TestD1): Promise<void> {
  await h.db.run(
    `INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');
     INSERT INTO position_templates (version, effective_year) VALUES ('synthetic-2026.2', 2026);
     INSERT INTO rule_books (version, effective_year, status, revision)
       VALUES ('synthetic-2026.2', 2026, 'active', 7);
     INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES ('A101', 'synthetic-template', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Synthetic Firefighter');
     INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('synthetic-2026.2', 'A101', 'synthetic-template',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');
     INSERT INTO bid_sessions
       (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
       VALUES ('${SESSION_ID}', 2026, ${CAPTURED_AT}, 'position_bid', 180, 2, 0, 1);`,
  );

  const members = [11, 12, 13, 17].map((memberId, index) => ({
    memberId,
    pool: 'FF',
    rscSeniority: index + 1,
    rankSeniority: index + 1,
    exclusionReason: null,
    authoritativeAssignmentId: null,
    rank: 'FF',
    isProbationary: false,
    credentialNames: [],
  }));
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, 'synthetic-2026.2', 'synthetic-template', 7, ?, ?);`,
    [
      SESSION_ID,
      JSON.stringify({
        v: 3,
        ruleBookVersion: 'synthetic-2026.2',
        ruleBookRevision: 7,
        positionTemplateVersion: 'synthetic-template',
        configurationRevision: 4,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
        capturedAtMs: CAPTURED_AT,
        members,
        ruleBookMaterial: {
          v: 1,
          rules: [
            {
              ruleBookVersion: 'synthetic-2026.2',
              positionId: 'A101',
              templateVersion: 'synthetic-template',
              requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
              pointsPreferenceJson: '{"max":0,"items":[]}',
              tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
            },
          ],
          positions: [
            {
              id: 'A101',
              templateVersion: 'synthetic-template',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
              shift: 'A',
              station: '1',
              unit: 'Engine 1',
              rankRequired: 'FF',
              positionName: 'Synthetic Firefighter',
            },
          ],
        },
      }),
      CAPTURED_AT,
    ],
  );
}

describe('mock normal-bid specialty rehearsal', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await seed(h);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('fails closed for every direct normal-bid writer while specialty interruption is active without changing normal bid state', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), normalBidState());
    const subject = new BidSessionDO(makeState(storage), h.env);
    const instance = () => subject;
    const beginBody = {
      command_id: 'specialty-begin-direct-writer-1',
      expected_revision: 0,
      request_id: 'specialty-direct-writer-request-1',
      position_id: 'A101',
      policy: syntheticPolicy(),
      reason: 'Synthetic specialty interruption protects every direct normal Bid writer.',
    };
    const begin = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': beginBody.command_id },
        body: JSON.stringify(beginBody),
      },
    );
    expect(begin.status).toBe(200);
    await h.db.run('UPDATE bid_sessions SET current_bidder_id = ? WHERE id = ?', [17, SESSION_ID]);

    const attempts = [
      {
        name: 'auto-bid',
        path: `/api/admin/rehearsal/${SESSION_ID}/auto-bid`,
        body: { count: 1, strategy: 'first_eligible' },
      },
      {
        name: 'manual-pick',
        path: `/api/admin/rehearsal/${SESSION_ID}/manual-pick`,
        body: { member_id: 17, position_id: 'A101', reason: 'Synthetic manual normal Bid pick.' },
      },
      {
        name: 'force-pick',
        path: `/api/admin/bid-session/${SESSION_ID}/force-pick`,
        body: {
          member_id: 17,
          position_id: 'A101',
          reason_code: 'force.cert_mandate',
          reason: 'Synthetic forced normal Bid pick.',
        },
      },
      {
        name: 'bid-for-member',
        path: `/api/admin/bid-session/${SESSION_ID}/bid-for-member`,
        body: {
          member_id: 17,
          position_id: 'A101',
          reason_code: 'bid_for_member.unreachable_phone',
          reason: 'Synthetic proxy normal Bid pick.',
        },
      },
    ];

    for (const attempt of attempts) {
      const response = await directNormalBidRequest(h, instance, attempt.path, attempt.body);
      expect(response.status, attempt.name).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: 'specialty_adjudication_active' });
    }

    expect(
      (await h.db.run('SELECT COUNT(*) AS count FROM bids WHERE bid_session_id = ?', [SESSION_ID]))
        .results,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await h.db.run('SELECT current_bidder_id, current_phase FROM bid_sessions WHERE id = ?', [
          SESSION_ID,
        ])
      ).results,
    ).toEqual([{ current_bidder_id: 17, current_phase: 'position_bid' }]);
    expect(await storage.get<BidSessionState>(bidSessionStateStorageKey(SESSION_ID))).toEqual(
      normalBidState(),
    );
  });

  it('suspends an actual mock normal turn, survives reconnect, resolves configured priority, and resumes the exact bidder without canonical staffing or portal publication', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), normalBidState());
    let subject = new BidSessionDO(makeState(storage), h.env);
    const instance = () => subject;
    const messages: Array<Record<string, unknown>> = [];
    const socket = {
      send(value: string) {
        messages.push(JSON.parse(value) as Record<string, unknown>);
      },
    } as unknown as WebSocket;
    const onMessage = subject as unknown as {
      onMessage(
        clientId: string,
        socket: WebSocket,
        event: MessageEvent,
        identity: { memberId: number; role: 'member' | 'admin' },
      ): Promise<void>;
    };

    await onMessage.onMessage(
      'normal-bidder-17',
      socket,
      { data: JSON.stringify({ type: 'hello' }) } as MessageEvent,
      { memberId: 17, role: 'member' },
    );

    const beginBody = {
      command_id: 'specialty-begin-normal-1',
      expected_revision: 0,
      request_id: 'specialty-normal-request-1',
      position_id: 'A101',
      policy: syntheticPolicy(),
      reason: 'Synthetic specialty interruption on a mock normal Bid turn.',
    };
    const begin = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': beginBody.command_id },
        body: JSON.stringify(beginBody),
      },
    );
    expect(begin.status).toBe(200);
    await expect(begin.json()).resolves.toMatchObject({
      mode: 'synthetic_test_only',
      does_not_commit_bid: true,
      result: {
        kind: 'suspended',
        state: {
          revision: 1,
          active: {
            originalTurn: {
              bidderId: 17,
              ordinal: 42,
              queueCursor: 0,
              turnId: `normal:${SESSION_ID}:8:42:0:17`,
            },
          },
        },
      },
    });

    const duplicate = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': beginBody.command_id },
        body: JSON.stringify(beginBody),
      },
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ idempotent_replay: true });

    await onMessage.onMessage(
      'normal-bidder-17',
      socket,
      {
        data: JSON.stringify({
          type: 'submit_pick',
          positionId: 'A101',
          aDay: null,
          idempotencyKey: '11111111-1111-4111-8111-111111111111',
        }),
      } as MessageEvent,
      { memberId: 17, role: 'member' },
    );
    expect(messages.at(-1)).toMatchObject({
      type: 'pick_rejected',
      payload: { code: 'SESSION_PAUSED' },
      seq: 8,
    });
    expect(await storage.get<BidSessionState>(bidSessionStateStorageKey(SESSION_ID))).toEqual(
      normalBidState(),
    );

    // A new DO instance models a browser/DO reconnect halfway through the interruption.
    subject = new BidSessionDO(makeState(storage), h.env);
    const rehydrated = await routeRequest(h, instance, `/${SESSION_ID}/specialty-adjudication`);
    expect(rehydrated.status).toBe(200);
    await expect(rehydrated.json()).resolves.toMatchObject({
      state: {
        revision: 1,
        active: {
          originalTurn: { bidderId: 17, turnId: `normal:${SESSION_ID}:8:42:0:17` },
          candidateCursor: 0,
        },
      },
      audit_receipts: [
        expect.objectContaining({
          commandId: 'specialty-begin-normal-1',
          reason: 'Synthetic specialty interruption on a mock normal Bid turn.',
        }),
      ],
    });

    const stale = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/candidates`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-stale-1' },
        body: JSON.stringify({
          command_id: 'specialty-stale-1',
          expected_revision: 0,
          request_id: 'specialty-normal-request-1',
          member_id: 11,
          outcome: { kind: 'release', reason: 'declined' },
          reason: 'Verify stale specialty command rejection.',
        }),
      },
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: 'STALE_REVISION' });

    const outOfOrder = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/candidates`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-out-of-order-1' },
        body: JSON.stringify({
          command_id: 'specialty-out-of-order-1',
          expected_revision: 1,
          request_id: 'specialty-normal-request-1',
          member_id: 12,
          outcome: { kind: 'release', reason: 'unreachable' },
          reason: 'Verify configured candidate ordering.',
        }),
      },
    );
    expect(outOfOrder.status).toBe(409);
    await expect(outOfOrder.json()).resolves.toMatchObject({ error: 'OUT_OF_ORDER_CANDIDATE' });

    const candidateCommands = [
      {
        command_id: 'specialty-candidate-b-1',
        expected_revision: 1,
        member_id: 11,
        outcome: { kind: 'release', reason: 'declined' },
        reason: 'Configured priority candidate B declined the synthetic seat.',
      },
      {
        command_id: 'specialty-candidate-c-1',
        expected_revision: 2,
        member_id: 12,
        outcome: { kind: 'release', reason: 'unreachable' },
        reason: 'Configured priority candidate C was unavailable.',
      },
      {
        command_id: 'specialty-candidate-d-1',
        expected_revision: 3,
        member_id: 13,
        outcome: { kind: 'award', award_reference: 'synthetic-specialty-award-d' },
        reason: 'Configured priority candidate D accepted the synthetic seat.',
      },
    ];
    for (const command of candidateCommands) {
      const response = await routeRequest(
        h,
        instance,
        `/${SESSION_ID}/specialty-adjudication/candidates`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': command.command_id },
          body: JSON.stringify({
            ...command,
            request_id: 'specialty-normal-request-1',
          }),
        },
      );
      expect(response.status, command.command_id).toBe(200);
    }

    const resume = await routeRequest(h, instance, `/${SESSION_ID}/specialty-adjudication/resume`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'specialty-resume-normal-1' },
      body: JSON.stringify({
        command_id: 'specialty-resume-normal-1',
        expected_revision: 4,
        request_id: 'specialty-normal-request-1',
        reason: 'Synthetic specialty adjudication complete; resume original normal bidder.',
      }),
    });
    expect(resume.status).toBe(200);
    await expect(resume.json()).resolves.toMatchObject({
      result: {
        kind: 'resumed',
        normalTurn: {
          bidderId: 17,
          ordinal: 42,
          queueCursor: 0,
          turnId: `normal:${SESSION_ID}:8:42:0:17`,
        },
        state: { revision: 5, active: null },
      },
    });

    const resumedMessages: Array<Record<string, unknown>> = [];
    const resumedSocket = {
      send(value: string) {
        resumedMessages.push(JSON.parse(value) as Record<string, unknown>);
      },
    } as unknown as WebSocket;
    const resumedOnMessage = subject as unknown as {
      onMessage(
        clientId: string,
        socket: WebSocket,
        event: MessageEvent,
        identity: { memberId: number; role: 'member' | 'admin' },
      ): Promise<void>;
    };
    await resumedOnMessage.onMessage(
      'normal-bidder-17-reconnected',
      resumedSocket,
      { data: JSON.stringify({ type: 'hello' }) } as MessageEvent,
      { memberId: 17, role: 'member' },
    );
    await resumedOnMessage.onMessage(
      'normal-bidder-17-reconnected',
      resumedSocket,
      {
        data: JSON.stringify({
          type: 'submit_pick',
          positionId: 'A101',
          aDay: null,
          idempotencyKey: '11111111-1111-4111-8111-111111111111',
        }),
      } as MessageEvent,
      { memberId: 17, role: 'member' },
    );
    expect(resumedMessages.at(-1)).toMatchObject({
      type: 'pick_made',
      seq: 9,
      payload: { memberId: 17, positionId: 'A101' },
    });
    expect(await storage.get<BidSessionState>(bidSessionStateStorageKey(SESSION_ID))).toMatchObject(
      {
        currentPhase: 'complete',
        currentBidderId: null,
        lastSeq: 9,
        fills: { A101: { memberId: 17, ordinal: 42 } },
      },
    );
    expect((await h.db.run('SELECT COUNT(*) AS count FROM member_assignments')).results).toEqual([
      { count: 0 },
    ]);
    expect(
      (await h.db.run('SELECT COUNT(*) AS count FROM portal_writeback_queue')).results,
    ).toEqual([{ count: 0 }]);
  });
});
