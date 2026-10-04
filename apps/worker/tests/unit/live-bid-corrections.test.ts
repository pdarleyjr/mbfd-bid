import {
  BidDispositionSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
  LiveBidCommandSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { initializeAnnualOperations } from '../../src/lib/annual-bid-operations.js';

const ORIGINAL = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const COMMAND = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb';
const policy = FrozenLiveBidPolicySchema.parse({
  v: 1,
  policyRevision: 'synthetic-corrections',
  stages: [
    {
      id: 'ff',
      label: 'Firefighters',
      order: 0,
      kind: 'FIREFIGHTER',
      memberIds: [1, 2, 3],
      opportunityPositionIds: ['one', 'two', 'spare', 'early'],
    },
  ],
  dispositions: BidDispositionSchema.options.map((disposition) => ({
    disposition,
    advances: true,
    returns: false,
    returnStageId: null,
    retainsLaterSelectionRights: false,
    terminal: false,
    requiresReason: true,
    requiresEvidence: false,
    contactPolicyReference: null,
  })),
  actionPermissions: LiveBidActionSchema.options.map((action) => ({ action, actorMemberIds: [1] })),
  specialtyCatalogReference: null,
  aDayPolicyReference: null,
  transitionPolicyReference: null,
  publicationPolicyReference: null,
  annualOperations: {
    v: 1,
    stageOrder: ['ff'],
    requiredTopologyPositionIds: ['one', 'two', 'spare', 'early'],
    contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
    aDay: {
      combatGroups: ['G1', 'G2', 'G3', 'G4'],
      min: null,
      max: null,
      captainDcMax: null,
      specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
      execution: {
        timing: 'SIMULTANEOUS',
        officersPerGroup: null,
        sourceRef: 'synthetic:correction-a-day',
        constraints: [],
        timingExceptions: [
          {
            id: 'early',
            label: 'Early winner',
            timing: 'AFTER_POSITION_SELECTION',
            sourceRef: 'synthetic:early',
            positionIds: ['early'],
            profileIds: [],
          },
        ],
      },
    },
  },
});

function state(): BidSessionState {
  return {
    ...emptyBidSessionState('synthetic-corrections'),
    frozenAt: null,
    currentPhase: 'position_bid',
    currentBidderId: 3,
    queueCursor: 2,
    lastSeq: 2,
    bidOrder: [1, 2, 3].map((memberId, index) => ({
      memberId,
      ordinal: index + 1,
      pool: 'FF' as const,
      stageId: 'ff',
    })),
    fills: {
      one: { memberId: 1, ordinal: 1, bidId: 'award-1', aDay: 'G1' },
      two: { memberId: 2, ordinal: 2, bidId: 'award-2', aDay: 'G2' },
    },
    annual: initializeAnnualOperations({ preferenceSheets: [] }),
    live: {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: 'award-2',
      dispositions: [],
    },
  };
}

function correction(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: 'live.correct_bid',
    commandId: COMMAND,
    bidSessionId: 'synthetic-corrections',
    expectedSeq: 2,
    actor: { id: 1, role: 'admin' },
    reason: 'Operator recorded the wrong A-Day',
    evidenceReference: null,
    memberId: 1,
    originalCommandId: ORIGINAL,
    originalBidId: 'award-1',
    originalPositionId: 'one',
    originalADayCommandId: null,
    operation: 'REPLACE',
    replacement: { positionId: 'one', aDay: 'G3' },
    ...overrides,
  };
}

const reduce = (before: BidSessionState, raw = correction(), id = 'correction-1') =>
  reduceLiveBidCommand(before, policy, raw as unknown as LiveBidCommand, 1000, id);

describe('audited compensating correction commands', () => {
  it('accepts the correction contract with an explicit source receipt and optional operator note', () => {
    expect(LiveBidCommandSchema.safeParse(correction()).success).toBe(true);
    expect(LiveBidCommandSchema.parse(correction({ reason: '   ' })).reason).toBe('');
    expect(reduce(state(), correction({ reason: '' })).ok).toBe(true);
  });

  it('corrects a prior non-last award on the same position without consuming the waiting turn', () => {
    const before = state();
    const result = reduce(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.fills.one).toMatchObject({
      memberId: 1,
      aDay: 'G3',
      bidId: 'correction-1',
    });
    expect(result.state.fills.two).toEqual(before.fills.two);
    expect(result.state).toMatchObject({ currentBidderId: 3, queueCursor: 2, lastSeq: 3 });
    expect(result.payload).toMatchObject({
      operation: 'correct_bid',
      supersedesBidId: 'award-1',
      replacementBidId: 'correction-1',
      originalCommandId: ORIGINAL,
    });
    expect(before.fills.one?.aDay).toBe('G1');
  });

  it('moves a prior award to an open legal seat and preserves its ordinal', () => {
    const result = reduce(
      state(),
      correction({ replacement: { positionId: 'spare', aDay: 'G3' } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.fills.one).toBeUndefined();
    expect(result.state.fills.spare).toMatchObject({ memberId: 1, ordinal: 1, aDay: 'G3' });
  });

  it('rejects already superseded and occupied source/target states', () => {
    expect(reduce(state(), correction({ originalBidId: 'old-award' }))).toMatchObject({
      ok: false,
      code: 'CORRECTION_SOURCE_NOT_ACTIVE',
    });
    expect(
      reduce(state(), correction({ replacement: { positionId: 'two', aDay: 'G3' } })),
    ).toMatchObject({ ok: false, code: 'POSITION_FILLED' });
  });

  it('releases capacity by revocation, blocks completion, and replaces from the revocation lineage after restart', () => {
    const revoked = reduce(state(), correction({ operation: 'REVOKE', replacement: null }));
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.state.fills.one).toBeUndefined();
    expect(revoked.payload).toMatchObject({ replacementBidId: null, bidId: 'correction-1' });
    const restarted = JSON.parse(JSON.stringify(revoked.state)) as BidSessionState;
    const completion = reduceLiveBidCommand(
      { ...restarted, currentPhase: 'complete', currentBidderId: null, queueCursor: 3 },
      policy,
      { ...correction(), type: 'live.complete_session' } as unknown as LiveBidCommand,
      2000,
      'completion',
    );
    expect(completion).toMatchObject({
      ok: false,
      code: 'UNRESOLVED_CORRECTIONS_BLOCK_COMPLETION',
    });
    const replaced = reduce(
      restarted,
      correction({
        expectedSeq: 3,
        originalCommandId: COMMAND,
        originalBidId: 'correction-1',
        replacement: { positionId: 'spare', aDay: 'G3' },
      }),
      'correction-2',
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.state.fills.spare).toMatchObject({
      memberId: 1,
      ordinal: 1,
      bidId: 'correction-2',
    });
  });

  it('preserves an early winner ordinary A-Day right and rejects collecting it before that turn', () => {
    const before = state();
    before.fills = Object.fromEntries(Object.entries(before.fills).filter(([id]) => id !== 'one'));
    before.fills.early = { memberId: 3, ordinal: 3, bidId: 'early-award' };
    before.currentBidderId = 1;
    before.queueCursor = 0;
    const early = { memberId: 3, originalPositionId: 'early', originalBidId: 'early-award' };
    expect(
      reduce(before, correction({ ...early, replacement: { positionId: 'early', aDay: 'G3' } })),
    ).toMatchObject({ ok: false, code: 'CORRECTION_ORDINARY_A_DAY_NOT_REACHED' });
    const result = reduce(
      before,
      correction({ ...early, replacement: { positionId: 'early', aDay: null } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.bidOrder).toEqual(before.bidOrder);
    expect(result.state.queueCursor).toBe(0);
    expect(result.state.fills.early?.aDay).toBeUndefined();
  });

  it('requires receipt-bound replacement after revocation and preserves an unrelated reoccupied source seat', () => {
    const revoked = reduce(state(), correction({ operation: 'REVOKE', replacement: null }));
    if (!revoked.ok) throw new Error('Synthetic revocation required');
    expect(
      reduceLiveBidCommand(
        revoked.state,
        policy,
        {
          ...correction(),
          type: 'live.force_selection',
          memberId: 1,
          positionId: 'spare',
          aDay: 'G3',
        } as unknown as LiveBidCommand,
        2000,
        'bypass',
      ),
    ).toMatchObject({ ok: false, code: 'CORRECTION_REPLACEMENT_REQUIRED' });
    revoked.state.fills.one = { memberId: 3, ordinal: 3, bidId: 'unrelated-new-award', aDay: 'G4' };
    const restored = reduce(
      revoked.state,
      correction({
        originalCommandId: COMMAND,
        originalBidId: 'correction-1',
        replacement: { positionId: 'spare', aDay: 'G3' },
      }),
      'correction-2',
    );
    if (!restored.ok) throw new Error(`Correction rejected: ${restored.code}`);
    expect(restored.state.fills.one).toEqual(revoked.state.fills.one);
    expect(restored.state.fills.spare?.memberId).toBe(1);
  });

  it('requires the existing amendment grant and rejects correction after final sealing', () => {
    expect(reduce(state(), correction({ actor: { id: 2, role: 'admin' } }))).toMatchObject({
      ok: false,
      code: 'LIVE_ACTION_FORBIDDEN',
    });
    const sealed = state();
    sealed.annual = {
      ...initializeAnnualOperations({ preferenceSheets: [] }),
      completion: { readyForFinalizationAtMs: 999, actorMemberId: 1 },
    };
    expect(reduce(sealed)).toMatchObject({ ok: false, code: 'ANNUAL_COMPLETION_SEALED' });
  });

  it('permits correction while paused without resuming or changing the ordinary queue', () => {
    const before = state();
    before.currentPhase = 'paused';
    if (!before.live) throw new Error('Synthetic live progress required');
    before.live = { ...before.live, pausedPhase: 'position_bid' };
    const result = reduce(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toMatchObject({
      currentPhase: 'paused',
      currentBidderId: 3,
      queueCursor: 2,
    });
  });
});
