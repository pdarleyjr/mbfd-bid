import type { FrozenLiveBidPolicy, LiveBidCommand } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type LiveReduction, reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';

// Early specialty award: seat at the interruption, A-Day only at the member's
// own ordinary turn, before junior members continue (2026-09-24 decision).
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
  policyRevision: 'synthetic-early-specialty',
  stages: [
    {
      id: 'ff',
      label: 'Firefighters',
      order: 0,
      memberIds: [1, 2, 3, 4, 5],
      opportunityPositionIds: ['s1', 's2', 'p3', 'p4', 'p5'],
      kind: 'FIREFIGHTER',
    },
  ],
  dispositions: (['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const).map(
    (disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
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
    stageOrder: ['ff'],
    requiredTopologyPositionIds: ['s1', 's2'],
    specialties: [
      {
        id: 'specialty',
        label: 'Synthetic specialty',
        mode: 'INTERRUPTING',
        opportunityPositionIds: ['s1', 's2'],
        requiredCredentialNames: [],
        requiredSpecialtyCodes: [],
        points: [],
        tieBreakChain: ['RSC_SENIORITY'],
      },
    ],
    contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
    aDay: {
      combatGroups: ['G1', 'G2', 'G3', 'G4'],
      min: null,
      max: null,
      captainDcMax: null,
      execution: {
        timing: 'SIMULTANEOUS',
        timingExceptions: [
          {
            id: 'early-specialty',
            label: 'Specialized award A-Day at ordinary rank turn',
            timing: 'AFTER_POSITION_SELECTION',
            sourceRef: 'synthetic: 2026-09-24 administrator decision',
            positionIds: ['s1', 's2'],
            profileIds: [],
          },
        ],
        officersPerGroup: null,
        sourceRef: 'synthetic',
        constraints: [],
      },
      specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
    },
  },
};

const noOfficerCap = { min: 0, max: 10, officersRequired: 0, officerMode: 'NONE' as const };
const aDayMembers = [1, 2, 3, 4, 5].map((memberId) => ({
  employeeId: String(memberId),
  firstName: 'Synthetic',
  lastName: `Member ${memberId}`,
  rank: 'FF' as const,
  rscSeniority: memberId,
  rankSeniority: memberId,
  isProbationary: false,
  credentials: [],
}));
const shiftByPosition: Record<string, 'A'> = { s1: 'A', s2: 'A', p3: 'A', p4: 'A', p5: 'A' };

let commandNumber = 0;
function command(type: LiveBidCommand['type'], extra: Record<string, unknown>): LiveBidCommand {
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
    bidOrder: [1, 2, 3, 4, 5].map((memberId) => ({
      ordinal: memberId,
      memberId,
      pool: 'FF' as const,
      stageId: 'ff',
    })),
    live: {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    },
  };
}

/** Mirrors the canonical boundary, which re-derives A-Day state after every command. */
function withCanonicalADay(state: BidSessionState): BidSessionState {
  const fills = Object.entries(state.fills);
  return {
    ...state,
    aDay: {
      groupCaps: {
        A: { G1: noOfficerCap, G2: noOfficerCap, G3: noOfficerCap, G4: noOfficerCap },
        B: { G1: noOfficerCap, G2: noOfficerCap, G3: noOfficerCap, G4: noOfficerCap },
        C: { G1: noOfficerCap, G2: noOfficerCap, G3: noOfficerCap, G4: noOfficerCap },
      },
      weekdayCaps: {},
      picks: state.aDay?.picks ?? [],
      bidOrder: fills.filter(([, fill]) => fill.aDay === undefined).map(([, f]) => f.memberId),
      cursor: 0,
      phase1: fills.map(([positionId, fill]) => [
        fill.memberId,
        { positionId, shift: shiftByPosition[positionId] ?? 'A' },
      ]),
    },
  };
}

function apply(state: BidSessionState, input: LiveBidCommand, bidId: string): BidSessionState {
  const result: LiveReduction = reduceLiveBidCommand(
    state,
    policy,
    { ...input, expectedSeq: state.lastSeq } as LiveBidCommand,
    1_000 + state.lastSeq,
    bidId,
    false,
    aDayMembers,
  );
  if (!result.ok) throw new Error(result.code);
  return withCanonicalADay(result.state);
}

function earlyAward(state: BidSessionState, candidateId: number, positionId: string) {
  const started = apply(
    state,
    command('live.start_specialty_adjudication', {
      specialtyId: 'specialty',
      positionId,
      candidateMemberIds: [candidateId],
    }),
    `start-${candidateId}`,
  );
  return apply(
    started,
    command('live.resolve_specialty_candidate', { memberId: candidateId, outcome: 'ACCEPT' }),
    `early-${candidateId}`,
  );
}

describe('early specialty award A-Day at the ordinary seniority turn', () => {
  it('continues reviewing several higher-priority members after the original requested seat is filled', () => {
    let result = apply(
      initial(),
      command('live.start_specialty_adjudication', {
        specialtyId: 'specialty',
        positionId: 's1',
        candidateMemberIds: [2, 3, 4],
      }),
      'start-multiple',
    );
    result = apply(
      result,
      command('live.resolve_specialty_candidate', { memberId: 2, outcome: 'ACCEPT' }),
      'first-specialty',
    );
    expect(result.live?.specialty).toMatchObject({ positionId: 's1', candidateCursor: 1 });
    expect(result.fills.s1).toMatchObject({ memberId: 2 });
    result = apply(
      result,
      command('live.resolve_specialty_candidate', {
        memberId: 3,
        outcome: 'ACCEPT',
        positionId: 's2',
      }),
      'second-specialty',
    );
    expect(result.live?.specialty).toBeNull();
    expect(result.fills.s2).toMatchObject({ memberId: 3 });
    expect(result.fills.s1?.aDay).toBeUndefined();
    expect(result.fills.s2?.aDay).toBeUndefined();
    expect(result.bidOrder).toEqual(initial().bidOrder);
    result = apply(
      result,
      command('live.record_selection', { memberId: 1, positionId: 'p3', aDay: 'G1' }),
      'changed-mind-regular',
    );
    expect(result).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: 2 });
    result = apply(result, command('live.record_a_day', { memberId: 2, aDay: 'G2' }), 'first-aday');
    expect(result).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: 3 });
    result = apply(
      result,
      command('live.record_a_day', { memberId: 3, aDay: 'G3' }),
      'second-aday',
    );
    expect(result).toMatchObject({ currentPhase: 'position_bid', currentBidderId: 4 });
  });

  it('lets the requester change their mind without waiving unresponded specialty priority', () => {
    const started = apply(
      initial(),
      command('live.start_specialty_adjudication', {
        specialtyId: 'specialty',
        positionId: 's1',
        candidateMemberIds: [2, 3],
      }),
      'start-cancel',
    );
    const closed = apply(started, command('live.close_specialty_adjudication', {}), 'close-cancel');
    expect(closed).toMatchObject({ currentBidderId: 1, queueCursor: 0, fills: {} });
    expect(closed.live?.specialty).toBeNull();
    expect(closed.live?.specialtyResponses ?? []).toEqual([]);
    expect(closed.bidOrder).toEqual(started.bidOrder);
  });
  it('accepts a related open specialty seat, preserves the original request, and prompts the winner at their turn', () => {
    const started = apply(
      initial(),
      command('live.start_specialty_adjudication', {
        specialtyId: 'specialty',
        positionId: 's1',
        candidateMemberIds: [2],
      }),
      'start-related',
    );
    const awarded = apply(
      started,
      command('live.resolve_specialty_candidate', {
        memberId: 2,
        outcome: 'ACCEPT',
        positionId: 's2',
      }),
      'related-award',
    );
    expect(awarded.fills.s1).toBeUndefined();
    expect(awarded.fills.s2).toMatchObject({ memberId: 2 });
    expect(awarded.fills.s2?.aDay).toBeUndefined();
    const changedMind = apply(
      awarded,
      command('live.record_selection', { memberId: 1, positionId: 'p3', aDay: 'G1' }),
      'regular-award',
    );
    expect(changedMind).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: 2 });
    expect(
      reduceLiveBidCommand(
        started,
        policy,
        command('live.resolve_specialty_candidate', {
          memberId: 2,
          outcome: 'ACCEPT',
          positionId: 'p3',
        }),
        2000,
        'wrong-specialty',
        false,
        aDayMembers,
      ),
    ).toMatchObject({ ok: false, code: 'SPECIALTY_POSITION_NOT_CONFIGURED' });
  });
  it('opens an A-Day-only turn at the early winner ordinary turn before junior members continue', () => {
    const awarded = earlyAward(initial(), 2, 's1');
    expect(awarded).toMatchObject({ currentBidderId: 1, queueCursor: 0 });
    expect(awarded.fills.s1).toMatchObject({ memberId: 2 });
    expect(awarded.fills.s1?.aDay).toBeUndefined();

    const first = apply(
      awarded,
      command('live.record_selection', { memberId: 1, positionId: 'p3', aDay: 'G1' }),
      'ordinary-1',
    );
    expect(first).toMatchObject({
      currentPhase: 'a_day_bid',
      currentBidderId: 2,
      queueCursor: 1,
    });

    // No second position for the early winner at their ordinary turn.
    expect(
      reduceLiveBidCommand(
        first,
        policy,
        command('live.record_selection', {
          expectedSeq: first.lastSeq,
          memberId: 2,
          positionId: 'p4',
          aDay: 'G2',
        }),
        2_000,
        'second-seat',
        false,
        aDayMembers,
      ),
    ).toMatchObject({ ok: false });

    const aDay = apply(
      first,
      command('live.record_a_day', { memberId: 2, aDay: 'G2' }),
      'deferred-2',
    );
    expect(aDay).toMatchObject({
      currentPhase: 'position_bid',
      currentBidderId: 3,
      queueCursor: 2,
    });
    expect(aDay.aDay?.picks).toEqual([expect.objectContaining({ memberId: 2, aDay: 'G2' })]);

    const third = apply(
      aDay,
      command('live.record_selection', { memberId: 3, positionId: 'p4', aDay: 'G3' }),
      'ordinary-3',
    );
    const fourth = apply(
      third,
      command('live.record_selection', { memberId: 4, positionId: 'p5', aDay: 'G4' }),
      'ordinary-4',
    );
    expect(fourth).toMatchObject({ currentBidderId: 5, currentPhase: 'position_bid' });
    expect(Object.values(fourth.fills).filter((fill) => fill.memberId === 2)).toHaveLength(1);
  });

  it('survives JSON persistence and reconnect before and during the deferred turn', () => {
    const awarded = earlyAward(initial(), 2, 's1');
    const restarted = JSON.parse(JSON.stringify(awarded)) as BidSessionState;
    const first = apply(
      restarted,
      command('live.record_selection', { memberId: 1, positionId: 'p3', aDay: 'G1' }),
      'ordinary-1',
    );
    const reconnected = JSON.parse(JSON.stringify(first)) as BidSessionState;
    expect(reconnected).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: 2 });
    const aDay = apply(
      reconnected,
      command('live.record_a_day', { memberId: 2, aDay: 'G1' }),
      'deferred-2',
    );
    expect(aDay).toMatchObject({ currentPhase: 'position_bid', currentBidderId: 3 });
  });

  it('opens each of several early winners at their own ordinary turns in seniority order', () => {
    const second = earlyAward(initial(), 2, 's1');
    const fourth = earlyAward(second, 4, 's2');
    const first = apply(
      fourth,
      command('live.record_selection', { memberId: 1, positionId: 'p3', aDay: 'G1' }),
      'ordinary-1',
    );
    expect(first).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: 2 });
    const secondADay = apply(
      first,
      command('live.record_a_day', { memberId: 2, aDay: 'G2' }),
      'deferred-2',
    );
    expect(secondADay).toMatchObject({ currentPhase: 'position_bid', currentBidderId: 3 });
    const third = apply(
      secondADay,
      command('live.record_selection', { memberId: 3, positionId: 'p4', aDay: 'G3' }),
      'ordinary-3',
    );
    expect(third).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: 4, queueCursor: 3 });
    const fourthADay = apply(
      third,
      command('live.record_a_day', { memberId: 4, aDay: 'G4' }),
      'deferred-4',
    );
    expect(fourthADay).toMatchObject({ currentPhase: 'position_bid', currentBidderId: 5 });
  });

  it('selects the specialty seat and A-Day together when awarded at the member own turn', () => {
    expect(
      reduceLiveBidCommand(
        initial(),
        policy,
        command('live.record_selection', { memberId: 1, positionId: 's1' }),
        1_000,
        'own-turn-without-a-day',
        false,
        aDayMembers,
      ),
    ).toEqual({ ok: false, code: 'A_DAY_REQUIRED_WITH_SELECTION' });
    const ownTurn = apply(
      initial(),
      command('live.record_selection', { memberId: 1, positionId: 's1', aDay: 'G1' }),
      'own-turn',
    );
    expect(ownTurn.fills.s1).toMatchObject({ memberId: 1, aDay: 'G1' });
    expect(ownTurn).toMatchObject({ currentPhase: 'position_bid', currentBidderId: 2 });
  });

  it('rejects an A-Day recorded with an early specialty award', () => {
    const started = apply(
      initial(),
      command('live.start_specialty_adjudication', {
        specialtyId: 'specialty',
        positionId: 's1',
        candidateMemberIds: [2],
      }),
      'start-2',
    );
    expect(
      reduceLiveBidCommand(
        started,
        policy,
        command('live.resolve_specialty_candidate', {
          expectedSeq: started.lastSeq,
          memberId: 2,
          outcome: 'ACCEPT',
          aDay: 'G1',
        }),
        2_000,
        'early-with-a-day',
        false,
        aDayMembers,
      ),
    ).toEqual({ ok: false, code: 'A_DAY_DEFERRED_SELECTION_REQUIRED' });
  });

  it('lets the operator disposition an unavailable early winner without stalling the queue', () => {
    const awarded = earlyAward(initial(), 2, 's1');
    const first = apply(
      awarded,
      command('live.record_selection', { memberId: 1, positionId: 'p3', aDay: 'G1' }),
      'ordinary-1',
    );
    const passed = apply(first, command('live.disposition', { disposition: 'PASS' }), 'pass-2');
    expect(passed).toMatchObject({ currentPhase: 'position_bid', currentBidderId: 3 });
    expect(passed.live?.dispositions.at(-1)).toMatchObject({ memberId: 2, disposition: 'PASS' });
    expect(passed.fills.s1).toMatchObject({ memberId: 2 });
    // Remaining A-Day stays owed and is collected after the ordinary queue.
    const third = apply(
      passed,
      command('live.record_selection', { memberId: 3, positionId: 'p4', aDay: 'G3' }),
      'ordinary-3',
    );
    const fourth = apply(
      third,
      command('live.record_selection', { memberId: 4, positionId: 'p5', aDay: 'G4' }),
      'ordinary-4',
    );
    const fifth = apply(fourth, command('live.disposition', { disposition: 'PASS' }), 'pass-5');
    expect(fifth).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: 2 });
  });

  it('settles unreachable contact after the early winner later records their owed A-Day', () => {
    let state = earlyAward(initial(), 2, 's1');
    state = apply(
      state,
      command('live.record_selection', { memberId: 1, positionId: 'p3', aDay: 'G1' }),
      'ordinary-1',
    );
    state = apply(
      state,
      command('live.record_contact_attempt', { memberId: 2, method: 'PHONE' }),
      'contact-2',
    );
    state = apply(
      state,
      command('live.disposition', { disposition: 'UNREACHABLE' }),
      'unreachable-2',
    );
    expect(state.annual?.unresolvedMemberIds).toEqual([2]);
    state = apply(
      state,
      command('live.record_selection', { memberId: 3, positionId: 'p4', aDay: 'G3' }),
      'ordinary-3',
    );
    state = apply(
      state,
      command('live.record_selection', { memberId: 4, positionId: 'p5', aDay: 'G4' }),
      'ordinary-4',
    );
    state = apply(state, command('live.disposition', { disposition: 'PASS' }), 'pass-5');
    state = JSON.parse(JSON.stringify(state)) as BidSessionState;
    state = apply(state, command('live.record_a_day', { memberId: 2, aDay: 'G2' }), 'deferred-2');
    expect(state).toMatchObject({ currentPhase: 'complete', annual: { unresolvedMemberIds: [] } });
    expect(state.annual?.contactAttempts).toEqual([
      expect.objectContaining({ memberId: 2, method: 'PHONE' }),
    ]);
    expect(state.live?.dispositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 2, disposition: 'UNREACHABLE' }),
      ]),
    );
    expect(Object.values(state.fills).filter((fill) => fill.memberId === 2)).toHaveLength(1);
    expect(
      reduceLiveBidCommand(
        state,
        policy,
        command('live.complete_session', { expectedSeq: state.lastSeq }),
        9_000,
        'complete',
        false,
        aDayMembers,
      ),
    ).toMatchObject({ ok: true });
  });

  it('permits contact tracking for an awarded member while their deferred A-Day remains owed', () => {
    const state = earlyAward(initial(), 2, 's1');
    const unreachable = apply(
      state,
      command('live.declare_unreachable', { memberId: 2 }),
      'unreachable-early-2',
    );
    expect(unreachable.annual?.unresolvedMemberIds).toEqual([2]);
    expect(unreachable.fills.s1).toMatchObject({ memberId: 2 });
  });
});
