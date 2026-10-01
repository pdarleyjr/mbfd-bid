import type { FrozenLiveBidPolicy, LiveBidCommand } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type LiveReduction, reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { initializeAnnualOperations } from '../../src/lib/annual-bid-operations.js';

// Mirrors the saved 2026 dispositions: none terminal; UNREACHABLE and DEFER
// retain later selection rights; PASS/DECLINED/SKIP do not.
const RETAINS = new Set(['UNREACHABLE', 'DEFER']);
const ACTIONS = [
  'record_selection',
  'amend_selection',
  'skip_defer',
  'mark_unreachable',
  'force',
  'resolve_tie',
  'alter_order',
  'pause_resume',
  'create_live_session',
  'approve_transition',
  'approve_final_results',
  'publish',
] as const;

const policy: FrozenLiveBidPolicy = {
  v: 1,
  policyRevision: 'synthetic-return',
  stages: [
    {
      id: 'captains',
      label: 'Captains',
      order: 0,
      memberIds: [1, 2],
      opportunityPositionIds: ['C1', 'C2'],
      kind: 'CAPTAIN',
    },
    {
      id: 'lieutenants',
      label: 'Lieutenants',
      order: 1,
      memberIds: [3, 4],
      opportunityPositionIds: ['L1', 'L2'],
      kind: 'LIEUTENANT',
    },
  ],
  dispositions: (['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const).map(
    (disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: RETAINS.has(disposition),
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    }),
  ),
  actionPermissions: ACTIONS.map((action) => ({ action, actorMemberIds: [99] })),
  specialtyCatalogReference: null,
  aDayPolicyReference: null,
  transitionPolicyReference: null,
  publicationPolicyReference: null,
  annualOperations: {
    v: 1,
    stageOrder: ['captains', 'lieutenants'],
    requiredTopologyPositionIds: ['C1'],
    specialties: [],
    contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
    aDay: {
      combatGroups: ['G1', 'G2', 'G3', 'G4'],
      min: null,
      max: null,
      captainDcMax: null,
      specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
    },
  },
};

let commandNumber = 0;
function command(type: LiveBidCommand['type'], extra: Record<string, unknown> = {}) {
  commandNumber += 1;
  return {
    v: 1,
    type,
    commandId: `00000000-0000-4000-8000-${String(commandNumber).padStart(12, '0')}`,
    bidSessionId: 's',
    expectedSeq: 0,
    actor: { id: 99, role: 'admin' },
    reason: 'synthetic operator reason',
    evidenceReference: null,
    ...extra,
  } as LiveBidCommand;
}

function initial(): BidSessionState {
  return {
    ...emptyBidSessionState('s'),
    currentPhase: 'position_bid',
    currentBidderId: 1,
    bidOrder: [
      { ordinal: 1, memberId: 1, pool: 'OFC', stageId: 'captains' },
      { ordinal: 2, memberId: 2, pool: 'OFC', stageId: 'captains' },
      { ordinal: 3, memberId: 3, pool: 'OFC', stageId: 'lieutenants' },
      { ordinal: 4, memberId: 4, pool: 'OFC', stageId: 'lieutenants' },
    ],
    live: {
      currentStageId: 'captains',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    },
    annual: initializeAnnualOperations({ preferenceSheets: [] }),
  };
}

function reduce(state: BidSessionState, input: LiveBidCommand): LiveReduction {
  return reduceLiveBidCommand(
    state,
    policy,
    { ...input, expectedSeq: state.lastSeq } as LiveBidCommand,
    1_000 + state.lastSeq,
    `bid-${state.lastSeq + 1}`,
  );
}
function apply(state: BidSessionState, input: LiveBidCommand): BidSessionState {
  const result = reduce(state, input);
  if (!result.ok) throw new Error(result.code);
  return result.state;
}
const select = (memberId: number, positionId: string) =>
  command('live.record_selection', { memberId, positionId });

function captainUnreachableThenLieutenantStage() {
  let state = apply(initial(), command('live.disposition', { disposition: 'UNREACHABLE' }));
  state = apply(state, select(2, 'C1'));
  expect(state).toMatchObject({ currentBidderId: 3, currentPhase: 'position_bid' });
  expect(state.annual?.unresolvedMemberIds).toEqual([1]);
  return state;
}

describe('returned unreachable member keeps their own stage rights', () => {
  it('lets a returned Captain take the open Captain seat during the Lieutenant stage', () => {
    let state = captainUnreachableThenLieutenantStage();
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    state = apply(state, select(1, 'C2'));
    expect(state.fills.C2).toMatchObject({ memberId: 1 });
    expect(state).toMatchObject({ currentBidderId: 3, queueCursor: 2 });
    expect(state.annual).toMatchObject({ returningMemberId: null, unresolvedMemberIds: [] });
    // The returned Captain cannot take a Lieutenant seat.
    state = apply(state, select(3, 'L1'));
    expect(state).toMatchObject({ currentBidderId: 4 });
    expect(state.bidOrder.map((entry) => entry.memberId)).toEqual([1, 2, 3, 4]);
  });

  it('rejects a seat outside the returned member stage', () => {
    let state = captainUnreachableThenLieutenantStage();
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    expect(reduce(state, select(1, 'L1'))).toMatchObject({
      ok: false,
      code: 'LIVE_STAGE_NOT_ELIGIBLE',
    });
  });

  it('processes a member who returns after the ordinary queue is exhausted', () => {
    let state = captainUnreachableThenLieutenantStage();
    state = apply(state, select(3, 'L1'));
    state = apply(state, select(4, 'L2'));
    expect(state).toMatchObject({ currentPhase: 'complete', currentBidderId: null });
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    state = apply(state, select(1, 'C2'));
    expect(state.fills.C2).toMatchObject({ memberId: 1 });
    expect(state.currentPhase).toBe('complete');
    expect(apply(state, command('live.complete_session')).annual?.completion).not.toBeNull();
  });

  it('rejects a duplicate return and a second concurrent return', () => {
    let state = apply(initial(), command('live.disposition', { disposition: 'UNREACHABLE' }));
    state = apply(state, command('live.disposition', { disposition: 'UNREACHABLE' }));
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    expect(
      reduce(state, command('live.return_at_current_sequence', { memberId: 1 })),
    ).toMatchObject({ ok: false, code: 'MEMBER_NOT_UNRESOLVED' });
    expect(
      reduce(state, command('live.return_at_current_sequence', { memberId: 2 })),
    ).toMatchObject({ ok: false, code: 'RETURNING_MEMBER_ACTIVE' });
  });

  it('allows a deferred member with retained selection rights to return', () => {
    let state = apply(initial(), command('live.disposition', { disposition: 'DEFER' }));
    state = apply(state, select(2, 'C1'));
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    state = apply(state, select(1, 'C2'));
    expect(state.fills.C2).toMatchObject({ memberId: 1 });
  });

  it('lets a member return within the same stage without consuming the waiting turn', () => {
    let state = apply(initial(), command('live.disposition', { disposition: 'UNREACHABLE' }));
    expect(state).toMatchObject({ currentBidderId: 2, queueCursor: 1 });
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    state = apply(state, select(1, 'C2'));
    expect(state).toMatchObject({ currentBidderId: 2, queueCursor: 1 });
    state = apply(state, select(2, 'C1'));
    expect(state).toMatchObject({ currentBidderId: 3, queueCursor: 2 });
  });

  it('records a final disposition when no legal seat remains for the returned member', () => {
    let state = captainUnreachableThenLieutenantStage();
    state = { ...state, fills: { ...state.fills, C2: { memberId: 900, ordinal: 9, bidId: 'x' } } };
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    expect(reduce(state, select(1, 'C2'))).toMatchObject({ ok: false, code: 'POSITION_FILLED' });
    state = apply(state, command('live.disposition', { disposition: 'PASS' }));
    expect(state).toMatchObject({ currentBidderId: 3, annual: { returningMemberId: null } });
    expect(state.live?.dispositions.at(-1)).toMatchObject({ memberId: 1, disposition: 'PASS' });
  });

  it('does not return a member who already holds an award', () => {
    const state = captainUnreachableThenLieutenantStage();
    expect(
      reduce(state, command('live.return_at_current_sequence', { memberId: 2 })),
    ).toMatchObject({ ok: false, code: 'MEMBER_NOT_UNRESOLVED' });
  });

  it('does not return an awarded member even when legacy contact state remains unresolved', () => {
    const state = captainUnreachableThenLieutenantStage();
    if (!state.annual) throw new Error('Annual state required');
    state.annual = { ...state.annual, unresolvedMemberIds: [1, 2] };
    expect(
      reduce(state, command('live.return_at_current_sequence', { memberId: 2 })),
    ).toMatchObject({ ok: false, code: 'MEMBER_NOT_UNRESOLVED' });
  });

  it('rejects declaring a fully awarded member unreachable', () => {
    const state = captainUnreachableThenLieutenantStage();
    expect(reduce(state, command('live.declare_unreachable', { memberId: 2 }))).toMatchObject({
      ok: false,
      code: 'MEMBER_ALREADY_SELECTED',
    });
  });

  it('keeps contact unresolved when a returned member is unreachable again', () => {
    let state = captainUnreachableThenLieutenantStage();
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    state = apply(state, command('live.disposition', { disposition: 'UNREACHABLE' }));
    expect(state.annual).toMatchObject({ unresolvedMemberIds: [1], returningMemberId: null });
    expect(
      apply(state, command('live.return_at_current_sequence', { memberId: 1 })).annual
        ?.returningMemberId,
    ).toBe(1);
  });

  it('does not grant a returned member rights to a later stage they have not reached', () => {
    let state = apply(initial(), command('live.disposition', { disposition: 'UNREACHABLE' }));
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    const configured: FrozenLiveBidPolicy = {
      ...policy,
      stages: policy.stages.map((stage) =>
        stage.id === 'lieutenants' ? { ...stage, memberIds: [...stage.memberIds, 1] } : stage,
      ),
    };
    expect(
      reduceLiveBidCommand(
        state,
        configured,
        { ...select(1, 'L1'), expectedSeq: state.lastSeq } as LiveBidCommand,
        2_000,
        'future-stage',
      ),
    ).toMatchObject({ ok: false, code: 'LIVE_STAGE_NOT_ELIGIBLE' });
  });

  it.each(['lieutenants', 'firefighters'] as const)(
    'lets a returned member of the final %s stage select after queue exhaustion',
    (lastStage) => {
      const annualOperations = policy.annualOperations;
      if (!annualOperations) throw new Error('Annual fixture required');
      const configured: FrozenLiveBidPolicy =
        lastStage === 'firefighters'
          ? {
              ...policy,
              stages: [
                ...policy.stages,
                {
                  id: 'firefighters',
                  label: 'Firefighters',
                  order: 2,
                  memberIds: [5],
                  opportunityPositionIds: ['F1'],
                  kind: 'FIREFIGHTER',
                },
              ],
              annualOperations: {
                ...annualOperations,
                stageOrder: ['captains', 'lieutenants', 'firefighters'],
              },
            }
          : policy;
      let state = initial();
      if (lastStage === 'firefighters')
        state.bidOrder = [
          ...state.bidOrder,
          { ordinal: 5, memberId: 5, pool: 'FF', stageId: 'firefighters' },
        ];
      const applyConfigured = (input: LiveBidCommand) => {
        const result = reduceLiveBidCommand(
          state,
          configured,
          { ...input, expectedSeq: state.lastSeq } as LiveBidCommand,
          1_000 + state.lastSeq,
          `bid-${state.lastSeq + 1}`,
        );
        if (!result.ok) throw new Error(result.code);
        state = result.state;
      };
      applyConfigured(select(1, 'C1'));
      applyConfigured(select(2, 'C2'));
      if (lastStage === 'lieutenants')
        applyConfigured(command('live.disposition', { disposition: 'UNREACHABLE' }));
      else applyConfigured(select(3, 'L1'));
      applyConfigured(select(4, 'L2'));
      if (lastStage === 'firefighters')
        applyConfigured(command('live.disposition', { disposition: 'UNREACHABLE' }));
      expect(state.currentPhase).toBe('complete');
      const memberId = lastStage === 'lieutenants' ? 3 : 5;
      applyConfigured(command('live.return_at_current_sequence', { memberId }));
      state = JSON.parse(JSON.stringify(state)) as BidSessionState;
      applyConfigured(select(memberId, lastStage === 'lieutenants' ? 'L1' : 'F1'));
      expect(state.currentPhase).toBe('complete');
      expect(state.annual).toMatchObject({ unresolvedMemberIds: [], returningMemberId: null });
      applyConfigured(command('live.complete_session'));
      expect(state.annual?.completion).not.toBeNull();
    },
  );
});

describe('completion requires frozen participant coverage', () => {
  function exhausted(firstDisposition: 'UNREACHABLE' | 'DEFER' | 'PASS') {
    let state = apply(initial(), command('live.disposition', { disposition: firstDisposition }));
    state = apply(state, select(2, 'C1'));
    state = apply(state, select(3, 'L1'));
    state = apply(state, select(4, 'L2'));
    expect(state).toMatchObject({ currentPhase: 'complete' });
    return state;
  }

  it('blocks completion while a returned member has neither a seat nor a final disposition', () => {
    let state = exhausted('UNREACHABLE');
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    expect(state.annual?.unresolvedMemberIds).toEqual([]);
    expect(reduce(state, command('live.complete_session'))).toEqual({
      ok: false,
      code: 'PARTICIPANT_COVERAGE_INCOMPLETE',
    });
  });

  it('blocks completion while a deferred member retains selection rights', () => {
    expect(reduce(exhausted('DEFER'), command('live.complete_session'))).toEqual({
      ok: false,
      code: 'PARTICIPANT_COVERAGE_INCOMPLETE',
    });
  });

  it('permits completion after a final disposition that ends selection rights', () => {
    expect(reduce(exhausted('PASS'), command('live.complete_session'))).toMatchObject({ ok: true });
    let state = exhausted('UNREACHABLE');
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    state = apply(state, command('live.disposition', { disposition: 'DECLINED' }));
    expect(state.annual).toMatchObject({ returningMemberId: null, unresolvedMemberIds: [] });
    expect(reduce(state, command('live.complete_session'))).toMatchObject({ ok: true });
  });

  it('survives JSON persistence during a return and permits a correction afterwards', () => {
    let state = captainUnreachableThenLieutenantStage();
    state = apply(state, command('live.return_at_current_sequence', { memberId: 1 }));
    state = JSON.parse(JSON.stringify(state)) as BidSessionState;
    state = apply(state, select(1, 'C2'));
    const amended = reduce(
      state,
      command('live.amend_selection', { memberId: 1, fromPositionId: 'C2', toPositionId: 'C1' }),
    );
    expect(amended).toMatchObject({ ok: false, code: 'POSITION_FILLED' });
    expect(state.live?.lastSelectionBidId).toBe(state.fills.C2?.bidId);
  });
});
