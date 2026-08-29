import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signJwt } from '../../src/lib/jwt.js';
import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';
import specialtyAdjudication from '../../src/routes/admin/specialty-adjudication.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 's'.repeat(64);
const SESSION_ID = '01HZZ0000000000000SPECIALTY';
const CAPTURED_AT = 1_784_070_000_000;

type DurableCall = { path: string; method: string; body: unknown };

function stubBidSessionNamespace(calls: DurableCall[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string, init?: RequestInit) => {
      const request = typeof input === 'string' ? new Request(input, init) : input;
      const body = request.method === 'GET' ? null : await request.json();
      calls.push({ path: new URL(request.url).pathname, method: request.method, body });
      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({
            mode: 'synthetic_test_only',
            state: {
              version: 1,
              revision: 0,
              active: null,
              consumedCommandIds: [],
              processedRequestIds: [],
              resumedRequestIds: [],
            },
            audit_receipts: [],
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          mode: 'synthetic_test_only',
          kind: 'accepted',
          idempotent_replay: false,
          result: { kind: 'suspended', state: { revision: 1 }, events: [] },
          audit_receipt: {
            origin: 'synthetic_specialty_test',
            actor_type: 'admin',
            actor_id: 0,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
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

function frozenV3Snapshot({
  includeSpecialtyQualifications = true,
  member17SpecialtyStatus = 'active',
}: {
  includeSpecialtyQualifications?: boolean;
  member17SpecialtyStatus?: 'active' | 'expired' | 'revoked' | 'removed';
} = {}) {
  const specialtyQualification = (status: 'active' | 'expired' | 'revoked' | 'removed') => ({
    specialtyCode: 'SYNTHETIC_MARINE',
    status,
    effectiveOn: '2026-08-01',
    expiresOn: status === 'expired' ? '2026-08-31' : null,
  });
  return {
    v: 3,
    ruleBookVersion: 'synthetic-2026.2',
    ruleBookRevision: 7,
    positionTemplateVersion: 'synthetic-template',
    configurationRevision: 4,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-08-31',
    },
    credentialEvaluationOn: '2026-08-31',
    capturedAtMs: CAPTURED_AT,
    members: [
      {
        memberId: 11,
        pool: 'FF',
        rscSeniority: 3,
        rankSeniority: 4,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: ['Synthetic credential', 'Marine Operations'],
        ...(includeSpecialtyQualifications
          ? { specialtyQualifications: [specialtyQualification('active')] }
          : {}),
      },
      {
        memberId: 17,
        pool: 'FF',
        rscSeniority: 4,
        rankSeniority: 5,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: ['Synthetic credential', 'Marine Operations'],
        ...(includeSpecialtyQualifications
          ? { specialtyQualifications: [specialtyQualification(member17SpecialtyStatus)] }
          : {}),
      },
    ],
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
          unit: 'Synthetic Unit',
          rankRequired: 'FF',
          positionName: 'Synthetic Firefighter',
        },
      ],
    },
  };
}

async function seedSession(h: TestD1, isMock: boolean): Promise<void> {
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
  await h.db.run(
    `INSERT INTO rule_books (version, effective_year, status, revision)
     VALUES ('synthetic-2026.2', 2026, 'active', 7);`,
  );
  await h.db.run(
    `INSERT INTO bid_sessions
       (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
     VALUES (?, 2026, ?, 'position_bid', 180, 2, 0, ?);`,
    [SESSION_ID, CAPTURED_AT, isMock ? 1 : 0],
  );
}

async function seedFrozenV3Snapshot(h: TestD1, snapshot = frozenV3Snapshot()): Promise<void> {
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      SESSION_ID,
      snapshot.ruleBookVersion,
      snapshot.positionTemplateVersion,
      snapshot.ruleBookRevision,
      JSON.stringify(snapshot),
      CAPTURED_AT,
    ],
  );
}

function syntheticPolicy() {
  return {
    source: 'synthetic',
    policy_reference: 'synthetic-specialty-fixture-v1',
    test_policy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-specialty-fixture-v1',
      specialty_pool: {
        id: 'MARINE_TEST_POOL',
        label: 'Marine Operations synthetic test pool',
      },
      qualification_requirements: {
        v: 1,
        credential_names: ['Marine Operations'],
        specialty_codes: ['SYNTHETIC_MARINE'],
      },
      ranking: {
        source: 'EXPLICIT_TEST_PRIORITY',
        reference: 'synthetic-marine-priority-v1',
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
    candidates: [
      {
        member_id: 11,
        explicit_priority: 1,
      },
      {
        member_id: 17,
        explicit_priority: 2,
      },
    ],
  };
}

async function request(
  h: TestD1,
  calls: DurableCall[],
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await freshAdmin()}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  return specialtyAdjudication.fetch(new Request(`http://x${path}`, { ...init, headers }), {
    ...h.env,
    JWT_SIGNING_KEY: KEY,
    BID_SESSION: stubBidSessionNamespace(calls),
  });
}

describe('synthetic specialty-adjudication admin transport', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('rejects a non-mock session before contacting the Durable Object', async () => {
    await seedSession(h, false);
    await seedFrozenV3Snapshot(h);
    const calls: DurableCall[] = [];

    const response = await request(h, calls, `/${SESSION_ID}/specialty-adjudication`);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'specialty_synthetic_test_mode_only',
      is_mock: false,
    });
    expect(calls).toEqual([]);
  });

  it('requires a frozen V3 session policy before it can contact the Durable Object', async () => {
    await seedSession(h, true);
    const calls: DurableCall[] = [];

    const response = await request(h, calls, `/${SESSION_ID}/specialty-adjudication`);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_missing',
    });
    expect(calls).toEqual([]);
  });

  it('rejects an unlabeled synthetic policy before contacting the Durable Object', async () => {
    await seedSession(h, true);
    await seedFrozenV3Snapshot(h);
    const calls: DurableCall[] = [];
    const policy = {
      ...syntheticPolicy(),
      test_policy: { ...syntheticPolicy().test_policy, policy_label: 'UNAPPROVED' },
    };

    const response = await request(h, calls, `/${SESSION_ID}/specialty-adjudication/requests`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'specialty-unlabeled-policy-1' },
      body: JSON.stringify({
        command_id: 'specialty-unlabeled-policy-1',
        expected_revision: 0,
        request_id: 'specialty-unlabeled-request-1',
        position_id: 'A101',
        policy,
        reason: 'Verify the test-policy boundary.',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_payload' });
    expect(calls).toEqual([]);
  });

  it('forwards a revisioned synthetic begin command with operator evidence, not an official policy', async () => {
    await seedSession(h, true);
    await seedFrozenV3Snapshot(h);
    const calls: DurableCall[] = [];

    const response = await request(h, calls, `/${SESSION_ID}/specialty-adjudication/requests`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'specialty-request-command-1' },
      body: JSON.stringify({
        command_id: 'specialty-request-command-1',
        expected_revision: 0,
        request_id: 'specialty-request-1',
        position_id: 'A101',
        policy: syntheticPolicy(),
        reason: 'Synthetic specialty interruption rehearsal.',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: 'synthetic_test_only',
      kind: 'accepted',
      audit_receipt: {
        origin: 'synthetic_specialty_test',
        actor_type: 'admin',
      },
    });
    expect(calls).toEqual([
      {
        path: '/admin/specialty-adjudication/begin',
        method: 'POST',
        body: expect.objectContaining({
          command: expect.objectContaining({
            commandId: 'specialty-request-command-1',
            expectedRevision: 0,
            requestId: 'specialty-request-1',
            positionId: 'A101',
            policy: expect.objectContaining({ source: 'synthetic' }),
          }),
          audit: expect.objectContaining({
            actorId: 0,
            reason: 'Synthetic specialty interruption rehearsal.',
            origin: 'synthetic_specialty_test',
          }),
        }),
      },
    ]);
    const forwarded = calls[0]?.body as {
      command?: { policy?: { candidates?: unknown[] } };
    };
    expect(forwarded.command?.policy?.candidates).toEqual([
      {
        memberId: 11,
        priorityRank: 0,
        generalEligibility: { status: 'eligible' },
        specialtyEligibility: { status: 'eligible' },
      },
      {
        memberId: 17,
        priorityRank: 1,
        generalEligibility: { status: 'eligible' },
        specialtyEligibility: { status: 'eligible' },
      },
    ]);
  });

  it('fails closed when a legacy V3 snapshot omits specialty lifecycle facts', async () => {
    await seedSession(h, true);
    await seedFrozenV3Snapshot(h, frozenV3Snapshot({ includeSpecialtyQualifications: false }));
    const calls: DurableCall[] = [];

    const response = await request(h, calls, `/${SESSION_ID}/specialty-adjudication/requests`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'specialty-missing-facts-command-1' },
      body: JSON.stringify({
        command_id: 'specialty-missing-facts-command-1',
        expected_revision: 0,
        request_id: 'specialty-missing-facts-request-1',
        position_id: 'A101',
        policy: syntheticPolicy(),
        reason: 'Do not infer specialty evidence from a pre-bridge snapshot.',
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: 'synthetic_specialty_qualification_snapshot_unavailable',
    });
    expect(calls).toEqual([]);
  });

  it.each(['expired', 'revoked', 'removed'] as const)(
    'uses configured-date frozen %s specialty status instead of caller evidence',
    async (member17SpecialtyStatus) => {
      await seedSession(h, true);
      await seedFrozenV3Snapshot(h, frozenV3Snapshot({ member17SpecialtyStatus }));
      const calls: DurableCall[] = [];

      const response = await request(h, calls, `/${SESSION_ID}/specialty-adjudication/requests`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-revoked-command-1' },
        body: JSON.stringify({
          command_id: 'specialty-revoked-command-1',
          expected_revision: 0,
          request_id: 'specialty-revoked-request-1',
          position_id: 'A101',
          policy: syntheticPolicy(),
          reason: 'Use only frozen specialty qualification status at the configured date.',
        }),
      });

      expect(response.status).toBe(200);
      const forwarded = calls.at(0)?.body as {
        command?: { policy?: { candidates?: unknown[] } };
      };
      expect(forwarded.command?.policy?.candidates).toEqual([
        {
          memberId: 11,
          priorityRank: 0,
          generalEligibility: { status: 'eligible' },
          specialtyEligibility: { status: 'eligible' },
        },
        {
          memberId: 17,
          priorityRank: 1,
          generalEligibility: { status: 'eligible' },
          specialtyEligibility: {
            status: 'ineligible',
            reasonCodes: ['SYNTHETIC_SPECIALTY_CODE_NOT_ACTIVE:SYNTHETIC_MARINE'],
          },
        },
      ]);
    },
  );

  it('does not accept caller-supplied eligibility or an incomplete frozen candidate ranking', async () => {
    await seedSession(h, true);
    await seedFrozenV3Snapshot(h);
    const calls: DurableCall[] = [];
    const policy = syntheticPolicy();

    const callerEligibility = await request(
      h,
      calls,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-untrusted-eligibility-1' },
        body: JSON.stringify({
          command_id: 'specialty-untrusted-eligibility-1',
          expected_revision: 0,
          request_id: 'specialty-untrusted-request-1',
          position_id: 'A101',
          policy: {
            ...policy,
            candidates: [
              {
                member_id: 11,
                explicit_priority: 1,
                general_eligibility: { status: 'eligible' },
              },
              { member_id: 17, explicit_priority: 2 },
            ],
          },
          reason: 'Caller eligibility must not become synthetic engine evidence.',
        }),
      },
    );
    expect(callerEligibility.status).toBe(400);
    await expect(callerEligibility.json()).resolves.toEqual({ error: 'invalid_payload' });

    const incompleteRanking = await request(
      h,
      calls,
      `/${SESSION_ID}/specialty-adjudication/requests`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'specialty-incomplete-ranking-1' },
        body: JSON.stringify({
          command_id: 'specialty-incomplete-ranking-1',
          expected_revision: 0,
          request_id: 'specialty-incomplete-request-1',
          position_id: 'A101',
          policy: { ...policy, candidates: [{ member_id: 17, explicit_priority: 1 }] },
          reason: 'Synthetic policy must rank the full frozen Bid pool.',
        }),
      },
    );
    expect(incompleteRanking.status).toBe(422);
    await expect(incompleteRanking.json()).resolves.toEqual({
      error: 'synthetic_candidate_set_must_match_frozen_bid_pool',
    });
    expect(calls).toEqual([]);
  });

  it('rejects an official policy label before it contacts the Durable Object', async () => {
    await seedSession(h, true);
    await seedFrozenV3Snapshot(h);
    const calls: DurableCall[] = [];

    const response = await request(h, calls, `/${SESSION_ID}/specialty-adjudication/requests`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'specialty-official-command-1' },
      body: JSON.stringify({
        command_id: 'specialty-official-command-1',
        expected_revision: 0,
        request_id: 'specialty-request-1',
        position_id: 'A101',
        policy: { ...syntheticPolicy(), source: 'official' },
        reason: 'No official specialty policy has been approved.',
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: 'specialty_test_policy_must_be_synthetic',
    });
    expect(calls).toEqual([]);
  });
});
