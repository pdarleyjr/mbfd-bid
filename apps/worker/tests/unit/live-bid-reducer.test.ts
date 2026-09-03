import type { FrozenLiveBidPolicy, LiveBidCommand } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';

const policy: FrozenLiveBidPolicy = {
  v: 1,
  policyRevision: 'policy-1',
  stages: [
    {
      id: 'd',
      label: 'D',
      order: 0,
      memberIds: [1, 2],
      opportunityPositionIds: ['p1', 'p2'],
      kind: 'D_SHIFT',
    },
  ],
  dispositions: (['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const).map(
    (disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: disposition === 'DECLINED',
      requiresReason: true,
      requiresEvidence: disposition === 'UNREACHABLE',
      contactPolicyReference: null,
    }),
  ),
  actionPermissions: (
    [
      'record_selection',
      'amend_selection',
      'skip_defer',
      'mark_unreachable',
      'force',
      'resolve_tie',
      'alter_order',
      'pause_resume',
      'approve_transition',
      'approve_final_results',
      'publish',
    ] as const
  ).map((action) => ({ action, actorMemberIds: [99] })),
  specialtyCatalogReference: null,
  aDayPolicyReference: null,
  transitionPolicyReference: null,
  publicationPolicyReference: null,
};
function state(): BidSessionState {
  return {
    ...emptyBidSessionState('s'),
    currentPhase: 'position_bid' as const,
    currentBidderId: 1,
    bidOrder: [
      { ordinal: 1, memberId: 1, pool: 'FF' as const, stageId: 'd' },
      { ordinal: 2, memberId: 2, pool: 'FF' as const, stageId: 'd' },
    ],
    live: {
      currentStageId: 'd',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    },
  };
}
function command(
  type: LiveBidCommand['type'],
  extra: Record<string, unknown> = {},
): LiveBidCommand {
  return {
    v: 1,
    type,
    commandId: '00000000-0000-4000-8000-000000000001',
    bidSessionId: 's',
    expectedSeq: 0,
    actor: { id: 99, role: 'admin' },
    reason: 'operator reason',
    evidenceReference: null,
    ...extra,
  } as LiveBidCommand;
}
describe('live canonical reducer', () => {
  it('suspends the exact normal bidder for frozen specialty adjudication and resumes without queue rewind', () => {
    const specialtyPolicy: FrozenLiveBidPolicy = {
      ...policy,
      annualOperations: {
        v: 1,
        stageOrder: ['d'],
        requiredTopologyPositionIds: ['p1'],
        specialties: [
          {
            id: 'marine',
            label: 'Marine',
            mode: 'INTERRUPTING',
            opportunityPositionIds: ['p1'],
            requiredCredentialNames: ['Marine'],
            requiredSpecialtyCodes: ['MARINE'],
            points: [{ credentialName: 'Marine', value: 8 }],
            tieBreakChain: ['POINTS', 'RSC_SENIORITY', 'RANK_SENIORITY'],
          },
        ],
        contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 18,
          max: 19,
          captainDcMax: 2,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
        },
      },
    };
    const started = reduceLiveBidCommand(
      state(),
      specialtyPolicy,
      command('live.start_specialty_adjudication', {
        specialtyId: 'marine',
        positionId: 'p1',
        candidateMemberIds: [2],
      }),
      100,
      'specialty-start',
    );
    if (!started.ok) throw new Error(started.code);
    expect(started.state.live?.specialty?.suspendedBidderId).toBe(1);
    expect(
      reduceLiveBidCommand(
        started.state,
        specialtyPolicy,
        command('live.record_selection', { memberId: 1, positionId: 'p1' }),
        101,
        'blocked-pick',
      ),
    ).toMatchObject({ ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' });
    const resolved = reduceLiveBidCommand(
      started.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', { memberId: 2, outcome: 'ACCEPT' }),
      102,
      'specialty-award',
    );
    if (!resolved.ok) throw new Error(resolved.code);
    expect(resolved.state).toMatchObject({
      currentBidderId: 1,
      fills: { p1: { memberId: 2, bidId: 'specialty-award' } },
      bidOrder: [{ memberId: 1 }],
      live: { specialty: null },
    });
  });

  it('supersedes a specialty candidate previous award without losing its bid ordinal', () => {
    const specialtyPolicy: FrozenLiveBidPolicy = {
      ...policy,
      annualOperations: {
        v: 1,
        stageOrder: ['d'],
        requiredTopologyPositionIds: ['p1'],
        specialties: [
          {
            id: 'marine',
            label: 'Marine',
            mode: 'INTERRUPTING',
            opportunityPositionIds: ['p1'],
            requiredCredentialNames: ['Marine'],
            requiredSpecialtyCodes: ['MARINE'],
            points: [],
            tieBreakChain: ['RSC_SENIORITY'],
          },
        ],
        contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 18,
          max: 19,
          captainDcMax: 2,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
        },
      },
    };
    const priorAward = {
      ...state(),
      bidOrder: [{ ordinal: 1, memberId: 1, pool: 'FF' as const, stageId: 'd' }],
      fills: { p2: { memberId: 2, ordinal: 2, bidId: 'prior-award' } },
    };
    const started = reduceLiveBidCommand(
      priorAward,
      specialtyPolicy,
      command('live.start_specialty_adjudication', {
        specialtyId: 'marine',
        positionId: 'p1',
        candidateMemberIds: [2],
      }),
      100,
      'specialty-start',
    );
    if (!started.ok) throw new Error(started.code);

    const resolved = reduceLiveBidCommand(
      started.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', { memberId: 2, outcome: 'ACCEPT' }),
      101,
      'specialty-replacement',
    );
    if (!resolved.ok) throw new Error(resolved.code);
    expect(resolved.state.fills).toEqual({
      p1: { memberId: 2, ordinal: 2, bidId: 'specialty-replacement' },
    });
    expect(resolved.supersedesBidId).toBe('prior-award');
    expect(resolved.payload).toMatchObject({
      releasedPositionId: 'p2',
      supersedesBidId: 'prior-award',
      removedFromRemainingOrder: false,
    });
  });

  it('holds the department presentation without pausing the bid', () => {
    const held = reduceLiveBidCommand(
      state(),
      policy,
      command('live.set_presentation_mode', { mode: 'HOLD' }),
      100,
      'presentation-hold',
    );
    if (!held.ok) throw new Error(held.code);
    expect(held.state).toMatchObject({
      currentPhase: 'position_bid',
      live: {
        presentation: { mode: 'HOLD', heldAtSeq: 0, heldProjection: { currentBidderId: 1 } },
      },
    });
  });

  it('keeps the exact original bidder active after specialty decline and exhaustion', () => {
    const specialtyPolicy: FrozenLiveBidPolicy = {
      ...policy,
      annualOperations: {
        v: 1,
        stageOrder: ['d'],
        requiredTopologyPositionIds: ['p1'],
        specialties: [
          {
            id: 'marine',
            label: 'Marine',
            mode: 'INTERRUPTING',
            opportunityPositionIds: ['p1'],
            requiredCredentialNames: ['Marine'],
            requiredSpecialtyCodes: ['MARINE'],
            points: [],
            tieBreakChain: ['RSC_SENIORITY'],
          },
        ],
        contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 18,
          max: 19,
          captainDcMax: 2,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
        },
      },
    };
    const started = reduceLiveBidCommand(
      state(),
      specialtyPolicy,
      command('live.start_specialty_adjudication', {
        specialtyId: 'marine',
        positionId: 'p1',
        candidateMemberIds: [2, 3],
      }),
      100,
      'start',
    );
    if (!started.ok) throw new Error(started.code);
    const firstDecline = reduceLiveBidCommand(
      started.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', {
        expectedSeq: 1,
        memberId: 2,
        outcome: 'DECLINE',
      }),
      101,
      'decline-one',
    );
    if (!firstDecline.ok) throw new Error(firstDecline.code);
    expect(firstDecline.state.live?.specialty).toMatchObject({
      candidateCursor: 1,
      suspendedBidderId: 1,
    });
    const premature = reduceLiveBidCommand(
      firstDecline.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', {
        expectedSeq: 2,
        memberId: 3,
        outcome: 'UNREACHABLE',
        evidenceReference: 'contact-log-3',
      }),
      102,
      'decline-two',
    );
    expect(premature).toMatchObject({ ok: false, code: 'CONTACT_ATTEMPTS_INCOMPLETE' });
    let contacted = firstDecline.state;
    for (const index of [0, 1, 2]) {
      const attempt = reduceLiveBidCommand(
        contacted,
        specialtyPolicy,
        command('live.record_contact_attempt', {
          commandId: `10000000-0000-4000-8000-00000000000${index}`,
          expectedSeq: contacted.lastSeq,
          memberId: 3,
          method: index === 1 ? 'TEXT' : 'PHONE',
        }),
        102 + index,
        `contact-${index}`,
      );
      if (!attempt.ok) throw new Error(attempt.code);
      contacted = attempt.state;
    }
    const exhausted = reduceLiveBidCommand(
      contacted,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', {
        expectedSeq: contacted.lastSeq,
        memberId: 3,
        outcome: 'UNREACHABLE',
        evidenceReference: 'contact-log-3',
      }),
      106,
      'decline-two',
    );
    if (!exhausted.ok) throw new Error(exhausted.code);
    expect(exhausted.state).toMatchObject({
      currentBidderId: 1,
      live: { specialty: null },
      fills: {},
    });
  });

  it('records a staged selection and seals it after the next selection', () => {
    const first = reduceLiveBidCommand(
      state(),
      policy,
      command('live.record_selection', { memberId: 1, positionId: 'p1' }),
      100,
      'b1',
    );
    if (!first.ok) throw new Error(first.code);
    expect(first.state.currentBidderId).toBe(2);
    const second = reduceLiveBidCommand(
      first.state,
      policy,
      command('live.record_selection', {
        commandId: '00000000-0000-4000-8000-000000000002',
        expectedSeq: 1,
        memberId: 2,
        positionId: 'p2',
      }),
      101,
      'b2',
    );
    if (!second.ok) throw new Error(second.code);
    expect(second.state.live?.lastSelectionBidId).toBe('b2');
    const amended = reduceLiveBidCommand(
      second.state,
      policy,
      command('live.amend_selection', {
        commandId: '00000000-0000-4000-8000-000000000003',
        expectedSeq: 2,
        memberId: 1,
        fromPositionId: 'p1',
        toPositionId: 'p2',
      }),
      102,
      'b3',
    );
    expect(amended).toMatchObject({ ok: false, code: 'SELECTION_SEALED' });
  });
  it('amends the latest member selection to another eligible open opportunity', () => {
    const selected = reduceLiveBidCommand(
      state(),
      policy,
      command('live.record_selection', { memberId: 1, positionId: 'p1' }),
      100,
      'b1',
    );
    if (!selected.ok) throw new Error(selected.code);

    const amended = reduceLiveBidCommand(
      selected.state,
      policy,
      command('live.amend_selection', {
        commandId: '00000000-0000-4000-8000-000000000003',
        expectedSeq: 1,
        memberId: 1,
        fromPositionId: 'p1',
        toPositionId: 'p2',
      }),
      101,
      'b2',
    );
    if (!amended.ok) throw new Error(amended.code);
    expect(amended.state.fills).toEqual({ p2: { memberId: 1, ordinal: 1, bidId: 'b2' } });
    expect(amended.payload).toMatchObject({
      operation: 'amend_selection',
      memberId: 1,
      fromPositionId: 'p1',
      toPositionId: 'p2',
      supersedesBidId: 'b1',
    });
  });

  it('alters only the uncommitted order and preserves frozen member entries', () => {
    const result = reduceLiveBidCommand(
      state(),
      policy,
      command('live.alter_order', { orderedRemainingMemberIds: [2, 1] }),
      100,
      'unused',
    );
    if (!result.ok) throw new Error(result.code);
    expect(result.state.bidOrder.map((entry) => entry.memberId)).toEqual([2, 1]);
    expect(result.state.currentBidderId).toBe(2);
    expect(result.payload).toMatchObject({
      operation: 'alter_order',
      beforeMemberIds: [1, 2],
      afterMemberIds: [2, 1],
    });
  });

  it('rejects an altered order that drops a remaining member', () => {
    const result = reduceLiveBidCommand(
      state(),
      policy,
      command('live.alter_order', { orderedRemainingMemberIds: [2] }),
      100,
      'unused',
    );
    expect(result).toMatchObject({ ok: false, code: 'ALTER_ORDER_MEMBER_SET_MISMATCH' });
  });
  it('fails closed when a required disposition evidence pointer is absent', () => {
    const result = reduceLiveBidCommand(
      state(),
      policy,
      command('live.disposition', { disposition: 'UNREACHABLE' }),
      100,
      'b1',
    );
    expect(result).toMatchObject({ ok: false, code: 'DISPOSITION_EVIDENCE_REQUIRED' });
  });
  it('does not mark a completed session ready for finalization without frozen annual policy', () => {
    const result = reduceLiveBidCommand(
      { ...state(), currentPhase: 'complete' },
      policy,
      command('live.complete_session', {
        commandId: '00000000-0000-4000-8000-000000000099',
        expectedSeq: 0,
      }),
      100,
      'b-final',
    );
    expect(result).toMatchObject({ ok: false, code: 'ANNUAL_OPERATIONS_POLICY_MISSING' });
  });
  it('seals completed annual results against later amendments', () => {
    const initial = state();
    const live = initial.live;
    if (live === null || live === undefined) throw new Error('fixture live state missing');
    const result = reduceLiveBidCommand(
      {
        ...initial,
        currentPhase: 'complete',
        fills: { p1: { memberId: 1, ordinal: 1, bidId: 'b1' } },
        live: {
          ...live,
          lastSelectionBidId: 'b1',
        },
        annual: {
          preferenceSheets: [],
          contactAttempts: [],
          unresolvedMemberIds: [],
          returnedAtCurrentSequence: [],
          returningMemberId: null,
          checkpoint: null,
          completion: { readyForFinalizationAtMs: 100, actorMemberId: 99 },
        },
      },
      policy,
      command('live.amend_selection', {
        commandId: '00000000-0000-4000-8000-000000000100',
        memberId: 1,
        fromPositionId: 'p1',
        toPositionId: 'p2',
      }),
      101,
      'b2',
    );
    expect(result).toMatchObject({ ok: false, code: 'ANNUAL_COMPLETION_SEALED' });
  });
  it('records three minimal contact attempts and returns an unreachable member without rewinding the order', () => {
    let current = state();
    for (const [index, method] of ['PHONE', 'TEXT', 'PHONE'].entries()) {
      const result = reduceLiveBidCommand(
        current,
        {
          ...policy,
          annualOperations: {
            v: 1,
            stageOrder: ['d'],
            requiredTopologyPositionIds: ['p1'],
            contact: {
              minimumAttempts: 3,
              timingMode: 'OPERATOR_DISCRETION',
              durationSeconds: null,
            },
            aDay: {
              combatGroups: ['G1', 'G2', 'G3', 'G4'],
              min: 18,
              max: 19,
              captainDcMax: 2,
              specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
            },
          },
        },
        command('live.record_contact_attempt', {
          commandId: `00000000-0000-4000-8000-00000000000${index + 4}`,
          expectedSeq: index,
          memberId: 1,
          method,
        }),
        100 + index,
        `b${index + 4}`,
      );
      if (!result.ok) throw new Error(result.code);
      current = result.state;
    }
    const unreachable = reduceLiveBidCommand(
      current,
      {
        ...policy,
        annualOperations: {
          v: 1,
          stageOrder: ['d'],
          requiredTopologyPositionIds: ['p1'],
          contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: 18,
            max: 19,
            captainDcMax: 2,
            specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
          },
        },
      },
      command('live.declare_unreachable', {
        commandId: '00000000-0000-4000-8000-000000000007',
        expectedSeq: 3,
        memberId: 1,
      }),
      104,
      'b7',
    );
    if (!unreachable.ok) throw new Error(unreachable.code);
    const returned = reduceLiveBidCommand(
      unreachable.state,
      {
        ...policy,
        annualOperations: {
          v: 1,
          stageOrder: ['d'],
          requiredTopologyPositionIds: ['p1'],
          contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: 18,
            max: 19,
            captainDcMax: 2,
            specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
          },
        },
      },
      command('live.return_at_current_sequence', {
        commandId: '00000000-0000-4000-8000-000000000008',
        expectedSeq: 4,
        memberId: 1,
      }),
      105,
      'b8',
    );
    expect(returned).toMatchObject({ ok: true });
    if (!returned.ok) return;
    expect(returned.state.currentBidderId).toBe(1);
    expect(returned.state.bidOrder).toHaveLength(2);
    expect(returned.state.annual?.returnedAtCurrentSequence).toEqual([
      { memberId: 1, sequence: 4 },
    ]);
    expect(returned.state.annual?.returningMemberId).toBe(1);
  });
});
