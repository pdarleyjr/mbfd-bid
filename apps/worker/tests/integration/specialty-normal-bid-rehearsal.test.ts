import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type SpecialtyCommandReceipt,
  bidSessionSpecialtyReceiptPrefix,
  bidSessionSpecialtyStorageKey,
} from '../../src/durable/bid-session-specialty.js';
import {
  type BidSessionState,
  bidSessionStateStorageKey,
} from '../../src/durable/bid-session-state.js';
import {
  BidSessionDO,
  bidSessionNormalMutationLeaseStorageKey,
} from '../../src/durable/bid-session.js';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { SpecialtyAdjudicationState } from '../../src/lib/specialty-adjudication.js';
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

class CapturingSocket {
  readonly messages: Array<Record<string, unknown>> = [];

  readonly socket = {
    send: (value: string) => {
      this.messages.push(JSON.parse(value) as Record<string, unknown>);
    },
  } as unknown as WebSocket;
}

type BidSessionMessageHandler = {
  onMessage(
    clientId: string,
    socket: WebSocket,
    event: MessageEvent,
    identity: { memberId: number; role: 'member' | 'admin' },
  ): Promise<void>;
};

function messageHandler(subject: BidSessionDO): BidSessionMessageHandler {
  return subject as unknown as BidSessionMessageHandler;
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
    policy_reference: 'synthetic-specialty-rehearsal-v2',
    test_policy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-specialty-rehearsal-v2',
      specialty_pool: { id: 'SYNTHETIC_SPECIALTY_POOL', label: 'Synthetic specialty test pool' },
      qualification_requirements: {
        v: 1,
        credential_names: ['SYNTHETIC_CREDENTIAL_A'],
        specialty_codes: ['SYNTHETIC_SPECIALTY_A'],
      },
      ranking: {
        source: 'EXPLICIT_TEST_PRIORITY',
        reference: 'synthetic-specialty-priority-v2',
      },
      scoring: {
        source: 'EXPLICIT_TEST_PRIORITY',
        direction: 'LOWER_SCORE_WINS',
      },
      tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
      normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
      candidate_outcomes: ['award', 'declined', 'unreachable'],
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
        explicit_priority: 1,
      },
      {
        member_id: 12,
        explicit_priority: 2,
      },
      {
        member_id: 13,
        explicit_priority: 3,
      },
      {
        member_id: 17,
        explicit_priority: 4,
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
        'Idempotency-Key': 'specialty-normal-direct-writer',
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
        (id, bid_year, started_at, current_phase, current_bidder_id, turn_timer_seconds, expected_duration_days, day_count, is_mock)
        VALUES ('${SESSION_ID}', 2026, ${CAPTURED_AT}, 'position_bid', 17, 180, 2, 0, 1);
     INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool)
        VALUES ('${SESSION_ID}', 42, 17, 'FF');`,
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
    credentialNames: ['SYNTHETIC_CREDENTIAL_A'],
    specialtyQualifications: [
      {
        specialtyCode: 'SYNTHETIC_SPECIALTY_A',
        status: 'active',
        effectiveOn: '2026-08-01',
        expiresOn: null,
      },
    ],
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
        settings: {
          v: 2,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: '2026-08-28',
        },
        credentialEvaluationOn: '2026-08-28',
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
      expected_normal_control_revision: 0,
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
    const attempts = [
      {
        name: 'auto-bid',
        path: `/api/admin/rehearsal/${SESSION_ID}/auto-bid`,
        body: { count: 1, strategy: 'first_eligible', expected_mock_control_revision: 0 },
        expectedError: 'specialty_adjudication_active',
      },
      {
        name: 'manual-pick',
        path: `/api/admin/rehearsal/${SESSION_ID}/manual-pick`,
        body: {
          member_id: 17,
          position_id: 'A101',
          reason: 'Synthetic manual normal Bid pick.',
          expected_mock_control_revision: 0,
        },
        expectedError: 'specialty_adjudication_active',
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
        expectedError: 'mock_rehearsal_control_required',
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
        expectedError: 'mock_rehearsal_control_required',
      },
      {
        // A mock session must never route a legacy skip writer around the
        // rehearsal control plane. This boundary is reached before the
        // specialty lease and remains fail-closed while adjudication is live.
        name: 'skip',
        path: `/api/admin/bid-session/${SESSION_ID}/skip`,
        body: {
          member_id: 17,
          reason_code: 'skip.unreachable',
          reason: 'Synthetic direct normal Bid skip must use the rehearsal control plane.',
        },
        expectedError: 'mock_rehearsal_control_required',
      },
      {
        // Position locks are config-only legacy controls and, for a mock,
        // likewise cannot bypass the rehearsal control-plane boundary.
        name: 'lock-position',
        path: `/api/admin/bid-session/${SESSION_ID}/lock-position`,
        body: {
          member_id: 17,
          position_id: 'A101',
          reason_code: 'lock_position.probationary_placement',
          reason: 'Synthetic direct normal Bid lock must use the rehearsal control plane.',
        },
        expectedError: 'mock_rehearsal_control_required',
      },
      {
        name: 'pause',
        path: `/api/admin/bid-session/${SESSION_ID}/pause`,
        body: {
          reason_code: 'session.pause_emergency',
          reason: 'Synthetic direct normal Bid pause must not interrupt specialty adjudication.',
        },
        expectedError: 'specialty_adjudication_active',
      },
      {
        name: 'day-end',
        path: `/api/admin/bid-session/${SESSION_ID}/day-end`,
        body: {
          scheduled_resume_at: '2026-08-29T13:00:00.000Z',
          reason: 'Synthetic direct normal Bid day end must not interrupt specialty adjudication.',
        },
        expectedError: 'specialty_adjudication_active',
      },
      {
        // Specialty begin is permitted only from an active normal turn. The
        // direct resume route is therefore intentionally unreachable while
        // the interruption is active and fails before acquiring a writer
        // lease; it still must not mutate any normal state.
        name: 'resume',
        path: `/api/admin/bid-session/${SESSION_ID}/resume`,
        body: {},
        expectedError: 'invalid_state',
        expectedResponse: { error: 'invalid_state', current_phase: 'position_bid' },
      },
      {
        // See resume: day-start has the same paused-session precondition and
        // cannot become a concurrent normal writer during an active specialty
        // interruption.
        name: 'day-start',
        path: `/api/admin/bid-session/${SESSION_ID}/day-start`,
        body: {},
        expectedError: 'invalid_state',
        expectedResponse: { error: 'invalid_state', current_phase: 'position_bid' },
      },
    ];

    for (const attempt of attempts) {
      const response = await directNormalBidRequest(h, instance, attempt.path, attempt.body);
      expect(response.status, attempt.name).toBe(409);
      await expect(response.json()).resolves.toEqual(
        attempt.expectedResponse ?? { error: attempt.expectedError },
      );
    }

    expect(
      (await h.db.run('SELECT COUNT(*) AS count FROM bids WHERE bid_session_id = ?', [SESSION_ID]))
        .results,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await h.db.run(
          `SELECT current_bidder_id, current_phase, paused_at, scheduled_resume_at, day_count,
                  mock_control_revision, config_json
             FROM bid_sessions
            WHERE id = ?`,
          [SESSION_ID],
        )
      ).results,
    ).toEqual([
      {
        current_bidder_id: 17,
        current_phase: 'position_bid',
        paused_at: null,
        scheduled_resume_at: null,
        day_count: 0,
        mock_control_revision: 0,
        config_json: null,
      },
    ]);
    expect(
      (
        await h.db.run('SELECT COUNT(*) AS count FROM audit_log WHERE bid_session_id = ?', [
          SESSION_ID,
        ])
      ).results,
    ).toEqual([{ count: 0 }]);
    expect(await storage.get<BidSessionState>(bidSessionStateStorageKey(SESSION_ID))).toEqual(
      normalBidState(),
    );
  });

  it('serializes a durable normal-mutation permit, never expires an unresolved permit, and fails closed for unknown state', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), normalBidState());
    const subject = new BidSessionDO(makeState(storage), h.env);
    const instance = () => subject;

    const acquire = await subject.fetch(
      new Request('https://do/admin/normal-mutation-lease/acquire', { method: 'POST' }),
    );
    expect(acquire.status).toBe(200);
    const acquired = (await acquire.json()) as { ok: true; lease_id: string };

    const contention = await subject.fetch(
      new Request('https://do/admin/normal-mutation-lease/acquire', { method: 'POST' }),
    );
    expect(contention.status).toBe(409);
    await expect(contention.json()).resolves.toEqual({ error: 'normal_mutation_lease_active' });

    const blockedBegin = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-begin-held-lease-1' },
        body: JSON.stringify({
          command_id: 'specialty-begin-held-lease-1',
          expected_revision: 0,
          expected_normal_control_revision: 0,
          request_id: 'specialty-held-lease-request-1',
          position_id: 'A101',
          policy: syntheticPolicy(),
          reason: 'Specialty begin must wait for an acquired normal D1 mutation permit.',
        }),
      },
    );
    expect(blockedBegin.status).toBe(409);
    await expect(blockedBegin.json()).resolves.toMatchObject({
      error: 'normal_mutation_lease_active',
    });

    const release = await subject.fetch(
      new Request('https://do/admin/normal-mutation-lease/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lease_id: acquired.lease_id }),
      }),
    );
    expect(release.status).toBe(200);
    await expect(release.json()).resolves.toEqual({ ok: true });

    const beginAfterRelease = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-begin-released-lease-1' },
        body: JSON.stringify({
          command_id: 'specialty-begin-released-lease-1',
          expected_revision: 0,
          expected_normal_control_revision: 0,
          request_id: 'specialty-released-lease-request-1',
          position_id: 'A101',
          policy: syntheticPolicy(),
          reason: 'Specialty begin may continue only after the normal D1 permit releases.',
        }),
      },
    );
    expect(beginAfterRelease.status).toBe(200);

    // A worker that crashed after acquiring a permit has an unknowable D1
    // outcome. An old-but-well-formed record must therefore remain active;
    // there is no TTL that would silently let a specialty interruption pass.
    const crashedStorage = new MemoryDurableStorage();
    await crashedStorage.put(bidSessionStateStorageKey(SESSION_ID), normalBidState());
    await crashedStorage.put(bidSessionNormalMutationLeaseStorageKey(SESSION_ID), {
      version: 1,
      leaseId: 'crashed-lease',
      acquiredAtMs: 0,
    });
    const crashedSubject = new BidSessionDO(makeState(crashedStorage), h.env);
    const crashedAcquire = await crashedSubject.fetch(
      new Request('https://do/admin/normal-mutation-lease/acquire', { method: 'POST' }),
    );
    expect(crashedAcquire.status).toBe(409);
    await expect(crashedAcquire.json()).resolves.toEqual({ error: 'normal_mutation_lease_active' });

    const unknownStorage = new MemoryDurableStorage();
    await unknownStorage.put(bidSessionStateStorageKey(SESSION_ID), normalBidState());
    await unknownStorage.put(bidSessionNormalMutationLeaseStorageKey(SESSION_ID), {
      version: 99,
      leaseId: 'unknown-lease',
      acquiredAtMs: 0,
    });
    const unknownSubject = new BidSessionDO(makeState(unknownStorage), h.env);
    const unknownInstance = () => unknownSubject;
    const unknownAcquire = await unknownSubject.fetch(
      new Request('https://do/admin/normal-mutation-lease/acquire', { method: 'POST' }),
    );
    expect(unknownAcquire.status).toBe(409);
    await expect(unknownAcquire.json()).resolves.toEqual({
      error: 'normal_mutation_lease_state_unknown',
    });

    const unknownBegin = await routeRequest(
      h,
      unknownInstance,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-begin-unknown-lease-1' },
        body: JSON.stringify({
          command_id: 'specialty-begin-unknown-lease-1',
          expected_revision: 0,
          expected_normal_control_revision: 0,
          request_id: 'specialty-unknown-lease-request-1',
          position_id: 'A101',
          policy: syntheticPolicy(),
          reason: 'Unknown normal D1 permit state must remain fail-closed.',
        }),
      },
    );
    expect(unknownBegin.status).toBe(409);
    await expect(unknownBegin.json()).resolves.toMatchObject({
      error: 'normal_mutation_lease_state_unknown',
    });
  });

  it('releases a representative direct normal writer permit before a later specialty begin', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), normalBidState());
    const subject = new BidSessionDO(makeState(storage), h.env);
    const instance = () => subject;

    const manualPick = await directNormalBidRequest(
      h,
      instance,
      `/api/admin/rehearsal/${SESSION_ID}/manual-pick`,
      {
        member_id: 11,
        position_id: 'A101',
        reason: 'Representative direct normal D1 writer must release its permit.',
        expected_mock_control_revision: 0,
      },
    );
    expect(manualPick.status).toBe(201);

    const begin = await routeRequest(
      h,
      instance,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-begin-after-direct-writer-1' },
        body: JSON.stringify({
          command_id: 'specialty-begin-after-direct-writer-1',
          expected_revision: 0,
          expected_normal_control_revision: 1,
          request_id: 'specialty-after-direct-writer-request-1',
          position_id: 'A101',
          policy: syntheticPolicy(),
          reason: 'Synthetic specialty begins after the direct normal writer released its permit.',
        }),
      },
    );
    expect(begin.status).toBe(200);
  });

  it('reconstructs the persisted specialty interruption with a fresh admin socket, then resumes the exact mock normal bidder without canonical staffing or portal publication', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), normalBidState());
    let subject = new BidSessionDO(makeState(storage), h.env);
    const instance = () => subject;
    const normalBidderSocket = new CapturingSocket();
    const onMessage = messageHandler(subject);

    await onMessage.onMessage(
      'normal-bidder-17',
      normalBidderSocket.socket,
      { data: JSON.stringify({ type: 'hello' }) } as MessageEvent,
      { memberId: 17, role: 'member' },
    );

    const beginBody = {
      command_id: 'specialty-begin-normal-1',
      expected_revision: 0,
      expected_normal_control_revision: 0,
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
              turnId: `mock-normal:${SESSION_ID}:0:42:0:17`,
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
      normalBidderSocket.socket,
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
    expect(normalBidderSocket.messages.at(-1)).toMatchObject({
      type: 'pick_rejected',
      payload: { code: 'SESSION_PAUSED' },
      seq: 8,
    });
    expect(await storage.get<BidSessionState>(bidSessionStateStorageKey(SESSION_ID))).toEqual(
      normalBidState(),
    );

    const persistedState = await storage.get<SpecialtyAdjudicationState>(
      bidSessionSpecialtyStorageKey(SESSION_ID),
    );
    expect(persistedState).toMatchObject({
      revision: 1,
      active: {
        requestId: 'specialty-normal-request-1',
        positionId: 'A101',
        phase: 'resolving_higher_priority_candidates',
        candidateCursor: 0,
        resolution: null,
        originalTurn: {
          bidderId: 17,
          ordinal: 42,
          queueCursor: 0,
          turnId: `mock-normal:${SESSION_ID}:0:42:0:17`,
        },
      },
      consumedCommandIds: ['specialty-begin-normal-1'],
      processedRequestIds: ['specialty-normal-request-1'],
      resumedRequestIds: [],
    });
    expect(persistedState?.active?.rankedCandidates.map((candidate) => candidate.memberId)).toEqual(
      [11, 12, 13, 17],
    );
    expect(persistedState?.active?.candidateQueue.map((candidate) => candidate.memberId)).toEqual([
      11, 12, 13,
    ]);

    const persistedReceipts = await storage.list<SpecialtyCommandReceipt>({
      prefix: bidSessionSpecialtyReceiptPrefix(SESSION_ID),
    });
    expect([...persistedReceipts.values()]).toHaveLength(1);
    expect([...persistedReceipts.values()][0]).toMatchObject({
      version: 2,
      commandId: 'specialty-begin-normal-1',
      operation: 'begin',
      beforeState: { revision: 0, active: null },
      afterState: {
        revision: 1,
        active: {
          originalTurn: {
            bidderId: 17,
            ordinal: 42,
            queueCursor: 0,
            turnId: `mock-normal:${SESSION_ID}:0:42:0:17`,
          },
        },
      },
    });

    // A new DO instance plus a new admin socket models eviction/reconstruction
    // and a clean WebSocket connection. The socket receives a normal snapshot
    // and the isolated synthetic marker; the guarded status read supplies the
    // full persisted specialty control state.
    subject = new BidSessionDO(makeState(storage), h.env);
    const reconstructedAdminSocket = new CapturingSocket();
    const reconstructedOnMessage = messageHandler(subject);
    await reconstructedOnMessage.onMessage(
      'reconstructed-admin',
      reconstructedAdminSocket.socket,
      { data: JSON.stringify({ type: 'hello' }) } as MessageEvent,
      { memberId: 0, role: 'admin' },
    );
    expect(reconstructedAdminSocket.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'state_snapshot',
          seq: 8,
          payload: expect.objectContaining({
            bidSessionId: SESSION_ID,
            seq: 8,
            currentPhase: 'position_bid',
            currentBidderId: 17,
            bidOrder: [{ ordinal: 42, memberId: 17, pool: 'FF' }],
          }),
        }),
        expect.objectContaining({
          v: 1,
          type: 'synthetic_specialty_state_changed',
          mode: 'synthetic_test_only',
          does_not_commit_bid: true,
          bidSessionId: SESSION_ID,
          revision: 1,
        }),
      ]),
    );

    const rehydrated = await routeRequest(h, instance, `/${SESSION_ID}/specialty-adjudication`);
    expect(rehydrated.status).toBe(200);
    const rehydratedStatus = (await rehydrated.json()) as {
      state: SpecialtyAdjudicationState;
      audit_receipts: SpecialtyCommandReceipt[];
    };
    expect(rehydratedStatus).toMatchObject({
      state: {
        revision: 1,
        active: {
          originalTurn: { bidderId: 17, turnId: `mock-normal:${SESSION_ID}:0:42:0:17` },
          candidateCursor: 0,
        },
      },
      normal_turn: {
        bidder_id: 17,
        ordinal: 42,
        queue_cursor: 0,
        mock_control_revision: 0,
      },
      audit_receipts: [
        expect.objectContaining({
          commandId: 'specialty-begin-normal-1',
          reason: 'Synthetic specialty interruption on a mock normal Bid turn.',
        }),
      ],
    });
    expect(
      rehydratedStatus.state.active?.rankedCandidates.map((candidate) => candidate.memberId),
    ).toEqual([11, 12, 13, 17]);
    expect(
      rehydratedStatus.state.active?.candidateQueue.map((candidate) => candidate.memberId),
    ).toEqual([11, 12, 13]);
    expect(rehydratedStatus.audit_receipts).toHaveLength(1);

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
          turnId: `mock-normal:${SESSION_ID}:0:42:0:17`,
        },
        state: { revision: 5, active: null },
      },
    });

    const resumedState = await storage.get<SpecialtyAdjudicationState>(
      bidSessionSpecialtyStorageKey(SESSION_ID),
    );
    expect(resumedState).toMatchObject({
      revision: 5,
      active: null,
      resumedRequestIds: ['specialty-normal-request-1'],
    });
    const completedReceipts = await storage.list<SpecialtyCommandReceipt>({
      prefix: bidSessionSpecialtyReceiptPrefix(SESSION_ID),
    });
    expect([...completedReceipts.values()].map((receipt) => receipt.commandId)).toEqual([
      'specialty-begin-normal-1',
      'specialty-candidate-b-1',
      'specialty-candidate-c-1',
      'specialty-candidate-d-1',
      'specialty-resume-normal-1',
    ]);

    const resumedBidderSocket = new CapturingSocket();
    const resumedOnMessage = messageHandler(subject);
    await resumedOnMessage.onMessage(
      'normal-bidder-17-reconnected',
      resumedBidderSocket.socket,
      { data: JSON.stringify({ type: 'hello' }) } as MessageEvent,
      { memberId: 17, role: 'member' },
    );
    await resumedOnMessage.onMessage(
      'normal-bidder-17-reconnected',
      resumedBidderSocket.socket,
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
    expect(resumedBidderSocket.messages.at(-1)).toMatchObject({
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
