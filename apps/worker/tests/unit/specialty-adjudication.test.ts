import { describe, expect, it } from 'vitest';

import {
  type SpecialtyAdjudicationPolicy,
  type SpecialtyAdjudicationRequest,
  type SpecialtyAdjudicationState,
  beginSpecialtyAdjudication,
  createSpecialtyAdjudicationState,
  resolveOriginalSpecialtyRequest,
  resolveSpecialtyCandidate,
  resumeSpecialtyAdjudication,
} from '../../src/lib/specialty-adjudication.js';
import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';

const eligible = { status: 'eligible' } as const;

function ineligible(reasonCode: string) {
  return { status: 'ineligible' as const, reasonCodes: [reasonCode] };
}

const originalTurn = {
  turnId: 'normal-turn-17',
  bidderId: 17,
  ordinal: 42,
  queueCursor: 41,
} as const;

function syntheticPolicy(
  overrides: Partial<SpecialtyAdjudicationPolicy> = {},
): SpecialtyAdjudicationPolicy {
  return {
    policyReference: 'synthetic-marine-operator-v1',
    source: 'synthetic',
    testPolicy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-marine-operator-v1',
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
    candidateReleasePolicy: {
      status: 'configured',
      onRelease: 'continue_to_next_higher_priority',
    },
    // Deliberately unsorted: the engine must derive the approved priority
    // order from priorityRank, never incidental input order or seniority.
    candidates: [
      {
        memberId: 17,
        priorityRank: 4,
        generalEligibility: eligible,
        specialtyEligibility: eligible,
      },
      {
        memberId: 13,
        priorityRank: 3,
        generalEligibility: eligible,
        specialtyEligibility: eligible,
      },
      {
        memberId: 11,
        priorityRank: 1,
        generalEligibility: eligible,
        specialtyEligibility: eligible,
      },
      {
        memberId: 12,
        priorityRank: 2,
        generalEligibility: eligible,
        specialtyEligibility: eligible,
      },
      // This member ranks higher than the normal bidder but is not eligible,
      // so must not receive a specialty interruption turn.
      {
        memberId: 10,
        priorityRank: 0,
        generalEligibility: eligible,
        specialtyEligibility: ineligible('SPECIALTY_CREDENTIAL_MISSING'),
      },
    ],
    ...overrides,
  };
}

function request(
  overrides: Partial<SpecialtyAdjudicationRequest> = {},
): SpecialtyAdjudicationRequest {
  return {
    commandId: 'request-1',
    expectedRevision: 0,
    requestId: 'specialty-request-1',
    positionId: 'B601-MARINE-OPERATOR',
    normalTurn: originalTurn,
    policy: syntheticPolicy(),
    ...overrides,
  };
}

function expectSuspended(result: ReturnType<typeof beginSpecialtyAdjudication>) {
  expect(result.kind).toBe('suspended');
  if (result.kind !== 'suspended') throw new Error(`expected suspended, got ${result.kind}`);
  return result;
}

function suspend() {
  return expectSuspended(beginSpecialtyAdjudication(createSpecialtyAdjudicationState(), request()));
}

describe('specialty adjudication state machine', () => {
  it('rejects a synthetic policy without an explicit versioned test-policy envelope', () => {
    const policy = syntheticPolicy();
    const { testPolicy: _discarded, ...withoutTestPolicy } = policy;
    const result = beginSpecialtyAdjudication(
      createSpecialtyAdjudicationState(),
      request({ policy: withoutTestPolicy }),
    );

    expect(result).toMatchObject({ kind: 'rejected', code: 'INVALID_POLICY' });
  });

  it('suspends the exact normal turn for only eligible higher-priority candidates and emits serializable audit facts', () => {
    const initial = createSpecialtyAdjudicationState();
    const result = expectSuspended(beginSpecialtyAdjudication(initial, request()));

    expect(initial).toEqual(createSpecialtyAdjudicationState());
    expect(result.state.active).toMatchObject({
      requestId: 'specialty-request-1',
      positionId: 'B601-MARINE-OPERATOR',
      testPolicy: {
        policy_version: 'synthetic-marine-operator-v1',
        normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
        original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
      },
      originalTurn,
      phase: 'resolving_higher_priority_candidates',
      candidateQueue: [
        { memberId: 11, priorityRank: 1 },
        { memberId: 12, priorityRank: 2 },
        { memberId: 13, priorityRank: 3 },
      ],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'specialty_turn_suspended',
      payload: {
        testPolicyVersion: 'synthetic-marine-operator-v1',
        reason: 'higher_priority_eligible_candidates',
        originalTurn,
        higherPriorityCandidateIds: [11, 12, 13],
      },
    });

    // Durable Object storage/reconnect can round-trip this state without
    // losing the original turn or replacing arrays with Maps/Sets/Dates.
    const recoveredState = JSON.parse(JSON.stringify(result.state));
    expect(recoveredState).toEqual(result.state);
    const recoveredCommand = resolveSpecialtyCandidate(recoveredState, {
      commandId: 'recovered-candidate-11-release',
      expectedRevision: recoveredState.revision,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(recoveredCommand.kind).toBe('candidate_resolved');
  });

  it('rejects out-of-order and duplicate candidate commands, then awards a higher-priority candidate and resumes exactly once', () => {
    const suspended = suspend();

    const outOfOrder = resolveSpecialtyCandidate(suspended.state, {
      commandId: 'candidate-12-early',
      expectedRevision: suspended.state.revision,
      requestId: 'specialty-request-1',
      memberId: 12,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(outOfOrder).toMatchObject({ kind: 'rejected', code: 'OUT_OF_ORDER_CANDIDATE' });
    expect(outOfOrder.state).toEqual(suspended.state);

    const stale = resolveSpecialtyCandidate(suspended.state, {
      commandId: 'candidate-11-stale',
      expectedRevision: suspended.state.revision + 1,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(stale).toMatchObject({ kind: 'rejected', code: 'STALE_REVISION' });

    const firstReleased = resolveSpecialtyCandidate(suspended.state, {
      commandId: 'candidate-11-release',
      expectedRevision: suspended.state.revision,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(firstReleased.kind).toBe('candidate_resolved');
    if (firstReleased.kind !== 'candidate_resolved') return;
    expect(firstReleased.state.active).toMatchObject({
      phase: 'resolving_higher_priority_candidates',
      candidateCursor: 1,
      candidateOutcomes: [
        { memberId: 11, priorityRank: 1, outcome: { kind: 'release', reason: 'declined' } },
      ],
    });

    const duplicate = resolveSpecialtyCandidate(firstReleased.state, {
      commandId: 'candidate-11-release',
      expectedRevision: suspended.state.revision,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(duplicate).toMatchObject({ kind: 'rejected', code: 'DUPLICATE_COMMAND' });

    const awarded = resolveSpecialtyCandidate(firstReleased.state, {
      commandId: 'candidate-12-award',
      expectedRevision: firstReleased.state.revision,
      requestId: 'specialty-request-1',
      memberId: 12,
      outcome: { kind: 'award', awardReference: 'award-specialty-12' },
    });
    expect(awarded.kind).toBe('candidate_resolved');
    if (awarded.kind !== 'candidate_resolved') return;
    expect(awarded.state.active).toMatchObject({
      phase: 'awaiting_resume',
      resolution: {
        kind: 'awarded',
        awardedToMemberId: 12,
        awardReference: 'award-specialty-12',
        awardedBy: 'higher_priority_candidate',
      },
    });
    expect(awarded.events.map((event) => event.type)).toEqual([
      'specialty_candidate_resolved',
      'specialty_position_awarded',
    ]);

    const resumed = resumeSpecialtyAdjudication(awarded.state, {
      commandId: 'resume-1',
      expectedRevision: awarded.state.revision,
      requestId: 'specialty-request-1',
    });
    expect(resumed.kind).toBe('resumed');
    if (resumed.kind !== 'resumed') return;
    expect(resumed.normalTurn).toEqual(originalTurn);
    expect(resumed.state.active).toBeNull();
    expect(resumed.events).toMatchObject([
      {
        type: 'specialty_turn_resumed',
        payload: { requestId: 'specialty-request-1', originalTurn },
      },
    ]);

    const repeatedResume = resumeSpecialtyAdjudication(resumed.state, {
      commandId: 'resume-2',
      expectedRevision: resumed.state.revision,
      requestId: 'specialty-request-1',
    });
    expect(repeatedResume).toMatchObject({ kind: 'rejected', code: 'ALREADY_RESUMED' });
  });

  it('lets every higher-priority candidate release under an explicit synthetic policy, then resolves the original request before resuming it', () => {
    let state = suspend().state;
    for (const [memberId, commandId] of [
      [11, 'candidate-11-release'],
      [12, 'candidate-12-release'],
      [13, 'candidate-13-release'],
    ] as const) {
      const result = resolveSpecialtyCandidate(state, {
        commandId,
        expectedRevision: state.revision,
        requestId: 'specialty-request-1',
        memberId,
        outcome: { kind: 'release', reason: 'declined' },
      });
      expect(result.kind).toBe('candidate_resolved');
      if (result.kind !== 'candidate_resolved') return;
      state = result.state;
    }

    expect(state.active).toMatchObject({
      phase: 'awaiting_original_bidder',
      candidateOutcomes: [
        { memberId: 11, outcome: { kind: 'release', reason: 'declined' } },
        { memberId: 12, outcome: { kind: 'release', reason: 'declined' } },
        { memberId: 13, outcome: { kind: 'release', reason: 'declined' } },
      ],
    });

    const resolvedOriginal = resolveOriginalSpecialtyRequest(state, {
      commandId: 'original-award',
      expectedRevision: state.revision,
      requestId: 'specialty-request-1',
      outcome: { kind: 'award', awardReference: 'award-original-17' },
    });
    expect(resolvedOriginal.kind).toBe('original_resolved');
    if (resolvedOriginal.kind !== 'original_resolved') return;
    expect(resolvedOriginal.state.active).toMatchObject({
      phase: 'awaiting_resume',
      resolution: {
        kind: 'awarded',
        awardedToMemberId: 17,
        awardedBy: 'original_bidder',
      },
    });

    const resumed = resumeSpecialtyAdjudication(resolvedOriginal.state, {
      commandId: 'resume-original',
      expectedRevision: resolvedOriginal.state.revision,
      requestId: 'specialty-request-1',
    });
    expect(resumed).toMatchObject({ kind: 'resumed', normalTurn: originalTurn });
  });

  it('supports the explicit configured release-to-original policy without silently inventing a recall rule', () => {
    const started = expectSuspended(
      beginSpecialtyAdjudication(
        createSpecialtyAdjudicationState(),
        request({
          policy: syntheticPolicy({
            candidateReleasePolicy: {
              status: 'configured',
              onRelease: 'return_to_original_bidder',
            },
          }),
        }),
      ),
    );

    const release = resolveSpecialtyCandidate(started.state, {
      commandId: 'candidate-11-release',
      expectedRevision: started.state.revision,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'unreachable' },
    });
    expect(release.kind).toBe('candidate_resolved');
    if (release.kind !== 'candidate_resolved') return;
    expect(release.state.active).toMatchObject({ phase: 'awaiting_original_bidder' });
    expect(release.events.map((event) => event.type)).toEqual([
      'specialty_candidate_resolved',
      'specialty_original_request_ready',
    ]);

    const originalRelease = resolveOriginalSpecialtyRequest(release.state, {
      commandId: 'original-release',
      expectedRevision: release.state.revision,
      requestId: 'specialty-request-1',
      outcome: { kind: 'release', reason: 'withdrawn' },
    });
    expect(originalRelease.kind).toBe('original_resolved');
    if (originalRelease.kind !== 'original_resolved') return;
    expect(originalRelease.events.map((event) => event.type)).toEqual([
      'specialty_original_request_resolved',
      'specialty_position_released',
    ]);
    const resumed = resumeSpecialtyAdjudication(originalRelease.state, {
      commandId: 'resume-released-original',
      expectedRevision: originalRelease.state.revision,
      requestId: 'specialty-request-1',
    });
    expect(resumed).toMatchObject({
      kind: 'resumed',
      normalTurn: originalTurn,
      resolution: { kind: 'released', releasedByMemberId: 17, reason: 'withdrawn' },
    });
  });

  it('fails closed for a normal bidder who is generally or specially ineligible, ambiguous priority, or unresolved official policy', () => {
    const base = createSpecialtyAdjudicationState();

    const generallyIneligible = beginSpecialtyAdjudication(
      base,
      request({
        policy: syntheticPolicy({
          candidates: syntheticPolicy().candidates.map((candidate) =>
            candidate.memberId === 17
              ? { ...candidate, generalEligibility: ineligible('RANK_NOT_ALLOWED') }
              : candidate,
          ),
        }),
      }),
    );
    expect(generallyIneligible).toMatchObject({
      kind: 'rejected',
      code: 'ORIGINAL_GENERAL_INELIGIBLE',
    });

    const speciallyIneligible = beginSpecialtyAdjudication(
      base,
      request({
        commandId: 'request-2',
        policy: syntheticPolicy({
          candidates: syntheticPolicy().candidates.map((candidate) =>
            candidate.memberId === 17
              ? { ...candidate, specialtyEligibility: ineligible('MARINE_OPERATOR_MISSING') }
              : candidate,
          ),
        }),
      }),
    );
    expect(speciallyIneligible).toMatchObject({
      kind: 'rejected',
      code: 'ORIGINAL_SPECIALTY_INELIGIBLE',
    });

    const ambiguousPriority = beginSpecialtyAdjudication(
      base,
      request({
        commandId: 'request-3',
        policy: syntheticPolicy({
          candidates: [
            ...syntheticPolicy().candidates,
            {
              memberId: 99,
              priorityRank: 3,
              generalEligibility: eligible,
              specialtyEligibility: eligible,
            },
          ],
        }),
      }),
    );
    expect(ambiguousPriority).toMatchObject({
      kind: 'rejected',
      code: 'AMBIGUOUS_SPECIALTY_PRIORITY',
    });

    const unresolvedOfficialPolicy = beginSpecialtyAdjudication(
      base,
      request({
        commandId: 'request-4',
        policy: (() => {
          const { testPolicy: _discarded, ...officialPolicy } = syntheticPolicy();
          return {
            ...officialPolicy,
            source: 'official',
            candidateReleasePolicy: {
              status: 'unresolved',
              reason: 'MBFD decline and recall rule has not been approved.',
            },
          };
        })(),
      }),
    );
    expect(unresolvedOfficialPolicy).toMatchObject({
      kind: 'rejected',
      code: 'UNRESOLVED_OFFICIAL_POLICY',
    });
  });

  it('does not interrupt when no eligible higher-priority specialty candidate exists and rejects the repeated request', () => {
    const initial = createSpecialtyAdjudicationState();
    const result = beginSpecialtyAdjudication(
      initial,
      request({
        policy: syntheticPolicy({
          candidates: syntheticPolicy().candidates.map((candidate) =>
            candidate.memberId === 17
              ? { ...candidate, priorityRank: 0 }
              : candidate.memberId === 10
                ? { ...candidate, priorityRank: 5 }
                : candidate,
          ),
        }),
      }),
    );
    expect(result.kind).toBe('not_required');
    if (result.kind !== 'not_required') return;
    expect(result.state.active).toBeNull();
    expect(result.events).toMatchObject([
      {
        type: 'specialty_request_no_interruption',
        payload: { originalTurn, higherPriorityCandidateIds: [] },
      },
    ]);

    const duplicateRequest = beginSpecialtyAdjudication(result.state, {
      ...request(),
      commandId: 'request-2',
      expectedRevision: result.state.revision,
    });
    expect(duplicateRequest).toMatchObject({ kind: 'rejected', code: 'DUPLICATE_REQUEST' });
  });

  it('rejects a corrupt persisted state rather than attempting to resume or mutate it', () => {
    const corrupt = { ...createSpecialtyAdjudicationState(), version: 99 };
    const result = beginSpecialtyAdjudication(
      corrupt as unknown as SpecialtyAdjudicationState,
      request(),
    );
    expect(result).toMatchObject({ kind: 'rejected', code: 'INVALID_STATE' });
  });

  it('rejects a reconnect snapshot with a malformed candidate outcome log', () => {
    const suspended = suspend();
    const active = suspended.state.active;
    if (active === null) throw new Error('expected an active specialty adjudication');
    const corrupt = {
      ...suspended.state,
      active: {
        ...active,
        candidateOutcomes: [{ memberId: 'not-a-member-id' }],
      },
    };
    const result = resolveSpecialtyCandidate(corrupt as unknown as SpecialtyAdjudicationState, {
      commandId: 'candidate-11-after-corruption',
      expectedRevision: suspended.state.revision,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(result).toMatchObject({ kind: 'rejected', code: 'INVALID_STATE' });
  });
});
