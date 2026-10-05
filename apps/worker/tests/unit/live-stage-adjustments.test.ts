import {
  type FrozenLiveBidPolicy,
  type LiveBidCommand,
  isLiveBidActionAuthorized,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { liveBidPreviewActionForCommand } from '../../src/lib/admin-bid-override.js';

const stages = [
  { id: 'chiefs', kind: 'MIXED', memberIds: [1], opportunityPositionIds: ['DC1'] },
  { id: 'captains', kind: 'CAPTAIN', memberIds: [2], opportunityPositionIds: ['C1', 'C2'] },
  { id: 'lieutenants', kind: 'LIEUTENANT', memberIds: [3], opportunityPositionIds: ['L1'] },
  { id: 'specialty-ff', kind: 'FIREFIGHTER', memberIds: [4], opportunityPositionIds: ['S1'] },
  {
    id: 'firefighters',
    kind: 'FIREFIGHTER',
    memberIds: [4, 5],
    opportunityPositionIds: ['F1', 'F2'],
  },
] as const;
const policy = {
  v: 1,
  policyRevision: 'test',
  stages: stages.map((stage, order) => ({ ...stage, label: stage.id, order })),
  dispositions: [],
  actionPermissions: [{ action: 'approve_transition', actorMemberIds: [99] }],
} as unknown as FrozenLiveBidPolicy;

function state(): BidSessionState & { live: NonNullable<BidSessionState['live']> } {
  return {
    ...emptyBidSessionState('s'),
    currentPhase: 'position_bid',
    currentBidderId: 5,
    queueCursor: 5,
    bidOrder: stages
      .flatMap((stage) =>
        stage.memberIds.map((memberId) => ({
          memberId,
          pool: memberId < 4 ? ('OFC' as const) : ('FF' as const),
          stageId: stage.id,
        })),
      )
      .map((entry, ordinal) => ({ ...entry, ordinal })),
    fills: {
      L1: {
        memberId: 3,
        ordinal: 2,
        bidId: 'prior-lt',
        aDayDeferral: { commandId: 'prior', actorMemberId: 99, reason: '', positionId: 'L1' },
      },
      S1: {
        memberId: 4,
        ordinal: 3,
        bidId: 'prior-ff',
        aDayDeferral: { commandId: 'prior', actorMemberId: 99, reason: '', positionId: 'S1' },
      },
    },
    live: {
      currentStageId: 'firefighters',
      completedStageIds: [],
      dispositions: [],
      pausedPhase: null,
      lastSelectionBidId: null,
    },
  };
}
function command(fields: Record<string, unknown> = {}): LiveBidCommand {
  return {
    v: 1,
    type: 'live.transition_stage',
    commandId: '22222222-2222-4222-8222-222222222222',
    bidSessionId: 's',
    expectedSeq: 0,
    actor: { id: 99, role: 'admin' },
    reason: '',
    evidenceReference: null,
    stageId: 'firefighters',
    adminOverride: { acknowledged: true, warningCodes: [] },
    ...fields,
  } as LiveBidCommand;
}
function apply(current: BidSessionState, fields: Record<string, unknown> = {}) {
  return reduceLiveBidCommand(current, policy, command(fields), 100, 'adjustment');
}

describe('reviewed stage completion and open opportunity changes', () => {
  it('keeps legacy previews force-authorized while permitting approve-only stage adjustment previews', () => {
    const scoped = {
      ...policy,
      actionPermissions: [
        ...policy.actionPermissions,
        { action: 'amend_selection' as const, actorMemberIds: [99] },
      ],
    };
    expect(
      isLiveBidActionAuthorized(
        scoped,
        liveBidPreviewActionForCommand(command({ completePriorStages: true })),
        99,
      ),
    ).toBe(true);
    const correction: LiveBidCommand = {
      v: 1,
      type: 'live.correct_bid',
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      bidSessionId: 's',
      expectedSeq: 0,
      actor: { id: 99, role: 'admin' },
      reason: '',
      evidenceReference: null,
      memberId: 2,
      originalCommandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      originalBidId: 'award',
      originalPositionId: 'C1',
      originalADayCommandId: null,
      operation: 'REVOKE',
      replacement: null,
      adminOverride: { acknowledged: true, warningCodes: [] },
    };
    expect(isLiveBidActionAuthorized(scoped, 'amend_selection', 99)).toBe(true);
    expect(isLiveBidActionAuthorized(scoped, liveBidPreviewActionForCommand(correction), 99)).toBe(
      false,
    );
  });
  it('marks every earlier stage complete without changing awards, order or A-Day evidence', () => {
    const current = state();
    const result = apply(current, { completePriorStages: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.state.live?.completedStageIds).toEqual([
      'chiefs',
      'captains',
      'lieutenants',
      'specialty-ff',
    ]);
    expect(result.state.fills).toEqual(current.fills);
    expect(result.state.bidOrder).toEqual(current.bidOrder);
    expect(result.state.aDay).toEqual(current.aDay);
    expect(result.state.currentBidderId).toBe(5);
    expect(result.state.lastSeq).toBe(1);
    expect(result.payload.adminOverride).toMatchObject({ warningCodes: ['STAGE_COMPLETION'] });
  });

  it('does not bring completed officer A-Day turns back after the ordinary queue is exhausted', () => {
    const current = state();
    current.fills.F2 = { memberId: 5, ordinal: 5, bidId: 'last', aDay: 'G1' };
    const result = apply(current, { completePriorStages: true });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.currentBidderId).toBe(4);
    expect(result.state.currentPhase).toBe('a_day_bid');
  });

  it('withdraws an exact open slot and explicitly restores it without changing the frozen stages', () => {
    const current = state();
    const withdrawn = apply(current, { withdrawOpenPositionIds: ['C2'] });
    if (!withdrawn.ok) throw new Error(withdrawn.code);
    expect(withdrawn.state.live?.withdrawnPositionIds).toEqual(['C2']);
    expect(withdrawn.payload).toMatchObject({
      withdrawnPositionIds: ['C2'],
      restoredPositionIds: [],
    });
    expect(withdrawn.state.fills).toEqual(current.fills);
    const restored = apply(withdrawn.state, { restoreOpenPositionIds: ['C2'] });
    if (!restored.ok) throw new Error(restored.code);
    expect(restored.state.live?.withdrawnPositionIds).toEqual([]);
    expect(restored.payload.adminOverride).toMatchObject({
      warningCodes: ['OPPORTUNITY_RESTORATION'],
    });
    expect(policy.stages[1]?.opportunityPositionIds).toEqual(['C1', 'C2']);
  });

  it.each(['A801', 'unknown'])('rejects fixed, non-biddable or unknown slots: %s', (positionId) => {
    expect(apply(state(), { withdrawOpenPositionIds: [positionId] })).toEqual({
      ok: false,
      code: 'OPPORTUNITY_NOT_BIDDABLE',
    });
  });
  it('rejects occupied slots without disturbing an accepted fill', () => {
    expect(apply(state(), { withdrawOpenPositionIds: ['L1'] })).toEqual({
      ok: false,
      code: 'POSITION_FILLED',
    });
  });
  it('rejects contradictory withdrawal and restoration', () => {
    expect(
      apply(state(), { withdrawOpenPositionIds: ['C2'], restoreOpenPositionIds: ['C2'] }),
    ).toEqual({ ok: false, code: 'POSITION_WITHDRAWAL_RESTORATION_CONFLICT' });
  });
  it('requires the existing reviewed adjustment for new configuration fields', () => {
    expect(apply(state(), { withdrawOpenPositionIds: ['C2'], adminOverride: undefined })).toEqual({
      ok: false,
      code: 'ADMIN_STAGE_ADJUSTMENT_REVIEW_REQUIRED',
    });
  });
  it('rejects an unchanged same-stage request', () => {
    expect(apply(state())).toEqual({ ok: false, code: 'NO_STAGE_CONFIGURATION_CHANGE' });
  });
  it('uses approve_transition authority without requiring a separate force grant', () => {
    expect(apply(state(), { completePriorStages: true }).ok).toBe(true);
    expect(apply(state(), { completePriorStages: true, actor: { id: 98, role: 'admin' } })).toEqual(
      { ok: false, code: 'LIVE_ACTION_FORBIDDEN' },
    );
  });
  it('keeps paused configuration paused while updating its underlying next turn', () => {
    const current = state();
    current.currentPhase = 'paused';
    current.live = { ...current.live, pausedPhase: 'position_bid' };
    const result = apply(current, { completePriorStages: true });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.currentPhase).toBe('paused');
    expect(result.state.live?.pausedPhase).toBe('position_bid');
  });
  it('captures completion and withdrawal metadata when the presentation is held', () => {
    const current = state();
    current.live = {
      ...current.live,
      completedStageIds: ['captains'],
      withdrawnPositionIds: ['C2'],
    };
    const holdPolicy = {
      ...policy,
      actionPermissions: [
        ...policy.actionPermissions,
        { action: 'publish' as const, actorMemberIds: [99] },
      ],
    };
    const holdCommand: LiveBidCommand = {
      v: 1,
      type: 'live.set_presentation_mode',
      mode: 'HOLD',
      commandId: '88888888-8888-4888-8888-888888888888',
      bidSessionId: 's',
      expectedSeq: 0,
      actor: { id: 99, role: 'admin' },
      reason: '',
      evidenceReference: null,
    };
    const result = reduceLiveBidCommand(current, holdPolicy, holdCommand, 100, 'hold');
    if (!result.ok) throw new Error(result.code);
    expect(result.state.live?.presentation?.heldProjection).toMatchObject({
      completedStageIds: ['captains'],
      withdrawnPositionIds: ['C2'],
    });
  });
  it('reorders only open turns while retaining completed historical entries in place', () => {
    const current = state();
    current.queueCursor = 1;
    current.currentBidderId = 4;
    current.live = {
      ...current.live,
      completedStageIds: ['chiefs', 'captains', 'lieutenants', 'specialty-ff'],
    };
    const orderPolicy = {
      ...policy,
      actionPermissions: [
        ...policy.actionPermissions,
        { action: 'force' as const, actorMemberIds: [99] },
      ],
    };
    const reorder: LiveBidCommand = {
      v: 1,
      type: 'live.alter_order',
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      bidSessionId: 's',
      expectedSeq: 0,
      actor: { id: 99, role: 'admin' },
      reason: '',
      evidenceReference: null,
      orderedRemainingMemberIds: [5, 4],
      orderedRemainingTurns: [
        { memberId: 5, stageId: 'firefighters' },
        { memberId: 4, stageId: 'firefighters' },
      ],
      adminOverride: { acknowledged: true, warningCodes: [] },
    };
    const result = reduceLiveBidCommand(current, orderPolicy, reorder, 100, 'reorder');
    if (!result.ok) throw new Error(result.code);
    expect(result.state.bidOrder.slice(0, 4)).toEqual(current.bidOrder.slice(0, 4));
    expect(result.state.bidOrder.length).toBe(current.bidOrder.length);
    expect(result.state.bidOrder.slice(4).map((entry) => entry.memberId)).toEqual([5, 4]);
    expect(result.state.currentBidderId).toBe(5);
  });
});
