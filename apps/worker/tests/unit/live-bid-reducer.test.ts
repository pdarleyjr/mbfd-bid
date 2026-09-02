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
        positionId: 'p1',
        replacementMemberId: 2,
      }),
      102,
      'b3',
    );
    expect(amended).toMatchObject({ ok: false, code: 'SELECTION_SEALED' });
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
