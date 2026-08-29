import { describe, expect, it } from 'vitest';
import {
  beginSpecialtyAdjudication,
  createSpecialtyAdjudicationState,
} from '../../src/lib/specialty-adjudication.js';
import {
  acquireNormalBidMutationLease,
  guardNormalBidMutation,
  runWithNormalBidMutationLease,
} from '../../src/lib/specialty-interruption-guard.js';
import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';
import type { WorkerEnv } from '../../src/types/env.js';

function specialtyNamespace(
  fetchResponse: (input?: Request | string, init?: RequestInit) => Response | Promise<Response>,
): WorkerEnv['BID_SESSION'] {
  const stub = { fetch: fetchResponse };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
  } as unknown as WorkerEnv['BID_SESSION'];
}

function inactiveSyntheticStatus(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'synthetic_test_only',
    does_not_commit_bid: true,
    database_audit_log: 'not_written',
    state: {
      version: 1,
      revision: 0,
      active: null,
      consumedCommandIds: [],
      processedRequestIds: [],
      resumedRequestIds: [],
    },
    audit_receipts: [],
    ...overrides,
  };
}

function activeSyntheticStatus() {
  const result = beginSpecialtyAdjudication(createSpecialtyAdjudicationState(), {
    commandId: 'synthetic-command',
    expectedRevision: 0,
    requestId: 'synthetic-request',
    positionId: 'A101',
    normalTurn: { turnId: 'normal-turn-17', bidderId: 17, ordinal: 42, queueCursor: 0 },
    policy: {
      policyReference: 'synthetic-specialty-lease-guard-v1',
      source: 'synthetic',
      testPolicy: {
        policy_label: SPECIALTY_TEST_POLICY_LABEL,
        policy_version: 'synthetic-specialty-lease-guard-v1',
        specialty_pool: { id: 'MARINE_TEST_POOL', label: 'Marine Operations synthetic test pool' },
        qualification_requirements: ['Marine Operations'],
        ranking: { source: 'EXPLICIT_TEST_PRIORITY', reference: 'synthetic-priority-v1' },
        scoring: { source: 'EXPLICIT_TEST_PRIORITY', direction: 'LOWER_SCORE_WINS' },
        tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
        normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
        candidate_outcomes: [
          'award',
          'declined',
          'unreachable',
          'withdrawn',
          'ineligible_on_recheck',
        ],
        original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
      },
      candidateReleasePolicy: {
        status: 'configured',
        onRelease: 'continue_to_next_higher_priority',
      },
      candidates: [
        {
          memberId: 11,
          priorityRank: 1,
          generalEligibility: { status: 'eligible' },
          specialtyEligibility: { status: 'eligible' },
        },
        {
          memberId: 17,
          priorityRank: 2,
          generalEligibility: { status: 'eligible' },
          specialtyEligibility: { status: 'eligible' },
        },
      ],
    },
  });
  if (result.kind !== 'suspended') throw new Error(`expected suspended state, got ${result.kind}`);
  return inactiveSyntheticStatus({ state: result.state });
}

describe('guardNormalBidMutation', () => {
  it('allows a normal mutation only when the synthetic specialty status explicitly reports inactive', async () => {
    let requestedUrl = '';
    const result = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace((input?: Request | string) => {
          requestedUrl = typeof input === 'string' ? input : (input?.url ?? '');
          return new Response(JSON.stringify(inactiveSyntheticStatus()), { status: 200 });
        }),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(result).toEqual({ ok: true });
    expect(requestedUrl).toBe('https://do/admin/specialty-adjudication');
  });

  it('blocks a normal mutation while a synthetic specialty interruption is active', async () => {
    const result = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace(
          () =>
            new Response(JSON.stringify(activeSyntheticStatus()), {
              status: 200,
            }),
        ),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(result).toEqual({ ok: false, error: 'specialty_adjudication_active' });
  });

  it('fails closed when the specialty status cannot be read or is malformed', async () => {
    const unavailable = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace(() => new Response('unavailable', { status: 503 })),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );
    const malformed = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace(
          () => new Response(JSON.stringify({ state: {} }), { status: 200 }),
        ),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(unavailable).toEqual({ ok: false, error: 'specialty_adjudication_state_unavailable' });
    expect(malformed).toEqual({ ok: false, error: 'specialty_adjudication_state_unavailable' });
  });

  it.each([
    ['a non-synthetic envelope', inactiveSyntheticStatus({ mode: 'official' })],
    [
      'a wrong state version',
      inactiveSyntheticStatus({
        state: {
          version: 99,
          revision: 0,
          active: null,
          consumedCommandIds: [],
          processedRequestIds: [],
          resumedRequestIds: [],
        },
      }),
    ],
    [
      'a missing persisted-state array',
      inactiveSyntheticStatus({
        state: { version: 1, revision: 0, active: null, consumedCommandIds: [] },
      }),
    ],
    [
      'an incomplete active state',
      inactiveSyntheticStatus({
        state: {
          version: 1,
          revision: 1,
          active: { requestId: 'synthetic-request' },
          consumedCommandIds: ['synthetic-command'],
          processedRequestIds: ['synthetic-request'],
          resumedRequestIds: [],
        },
      }),
    ],
  ])('fails closed for %s', async (_label, payload) => {
    const result = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace(
          () => new Response(JSON.stringify(payload), { status: 200 }),
        ),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(result).toEqual({ ok: false, error: 'specialty_adjudication_state_unavailable' });
  });
});

describe('normal mutation lease transport', () => {
  it('fails closed when the acquire response is malformed', async () => {
    const result = await acquireNormalBidMutationLease(
      {
        BID_SESSION: specialtyNamespace(
          () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        ),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(result).toEqual({ ok: false, error: 'normal_mutation_lease_unavailable' });
  });

  it('does not run a direct writer when another durable normal-mutation lease is held', async () => {
    let writerRan = false;
    const result = await runWithNormalBidMutationLease(
      {
        BID_SESSION: specialtyNamespace(
          () =>
            new Response(JSON.stringify({ error: 'normal_mutation_lease_active' }), {
              status: 409,
            }),
        ),
      },
      '01HZZ0000000000000SPECREHEARSE',
      async () => {
        writerRan = true;
        return 'written';
      },
    );

    expect(result).toEqual({ ok: false, error: 'normal_mutation_lease_active' });
    expect(writerRan).toBe(false);
  });

  it('releases the durable permit after a representative direct writer completes', async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const result = await runWithNormalBidMutationLease(
      {
        BID_SESSION: specialtyNamespace((input?: Request | string, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : (input?.url ?? '');
          const method =
            init?.method ?? (typeof input === 'string' ? 'GET' : (input?.method ?? 'GET'));
          requests.push({
            url,
            method,
            body: typeof init?.body === 'string' ? init.body : undefined,
          });
          if (url.endsWith('/acquire')) {
            return new Response(JSON.stringify({ ok: true, lease_id: 'lease-for-writer-1' }), {
              status: 200,
            });
          }
          if (url.endsWith('/release')) {
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          return new Response('not found', { status: 404 });
        }),
      },
      '01HZZ0000000000000SPECREHEARSE',
      async () => 'written',
    );

    expect(result).toEqual({ ok: true, value: 'written' });
    expect(requests).toEqual([
      {
        url: 'https://do/admin/normal-mutation-lease/acquire',
        method: 'POST',
        body: undefined,
      },
      {
        url: 'https://do/admin/normal-mutation-lease/release',
        method: 'POST',
        body: JSON.stringify({ lease_id: 'lease-for-writer-1' }),
      },
    ]);
  });

  it('releases the durable permit when the direct writer throws', async () => {
    let releaseCalls = 0;
    const run = runWithNormalBidMutationLease(
      {
        BID_SESSION: specialtyNamespace((input?: Request | string) => {
          const url = typeof input === 'string' ? input : (input?.url ?? '');
          if (url.endsWith('/acquire')) {
            return new Response(JSON.stringify({ ok: true, lease_id: 'lease-writer-throws-1' }), {
              status: 200,
            });
          }
          if (url.endsWith('/release')) {
            releaseCalls++;
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          return new Response('not found', { status: 404 });
        }),
      },
      '01HZZ0000000000000SPECREHEARSE',
      async () => {
        throw new Error('simulated_d1_write_failure');
      },
    );

    await expect(run).rejects.toThrow('simulated_d1_write_failure');
    expect(releaseCalls).toBe(1);
  });

  it('fails closed when release has an unknown outcome after a direct writer completes', async () => {
    let writerRan = false;
    const result = await runWithNormalBidMutationLease(
      {
        BID_SESSION: specialtyNamespace((input?: Request | string) => {
          const url = typeof input === 'string' ? input : (input?.url ?? '');
          if (url.endsWith('/acquire')) {
            return new Response(JSON.stringify({ ok: true, lease_id: 'lease-release-unknown-1' }), {
              status: 200,
            });
          }
          if (url.endsWith('/release')) {
            return new Response(JSON.stringify({ error: 'normal_mutation_lease_state_unknown' }), {
              status: 409,
            });
          }
          return new Response('not found', { status: 404 });
        }),
      },
      '01HZZ0000000000000SPECREHEARSE',
      async () => {
        writerRan = true;
        return 'written';
      },
    );

    expect(writerRan).toBe(true);
    expect(result).toEqual({ ok: false, error: 'normal_mutation_lease_state_unknown' });
  });
});
