import type { FrozenLiveBidPolicy, LiveBidCommand } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';

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
  dispositions: ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'].map((disposition) => ({
    disposition,
    advances: disposition !== 'HOLD',
    returns: false,
    returnStageId: null,
    retainsLaterSelectionRights: false,
    terminal: disposition === 'DECLINED',
    requiresReason: true,
    requiresEvidence: disposition === 'UNREACHABLE',
    contactPolicyReference: null,
  })),
  actionPermissions: [
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
  ].map((action) => ({ action, actorMemberIds: [99] })),
  specialtyCatalogReference: null,
  aDayPolicyReference: null,
  transitionPolicyReference: null,
  publicationPolicyReference: null,
};
function state() {
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
    expect(first.ok && first.state.currentBidderId).toBe(2);
    const second =
      first.ok &&
      reduceLiveBidCommand(
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
    expect(second?.ok && second.state.live?.lastSelectionBidId).toBe('b2');
    const amended =
      second?.ok &&
      reduceLiveBidCommand(
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
    expect(amended && !amended.ok && amended.code).toBe('SELECTION_SEALED');
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
});
