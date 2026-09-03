import { describe, expect, it } from 'vitest';

import type { Member } from '@mbfd/eligibility';
import type { FrozenLiveBidPolicy, LiveBidCommand } from '@mbfd/shared';
import { reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import {
  handleSubmitADayPick,
  transitionToPhase2,
} from '../../src/durable/bid-session-aday-handlers.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import {
  type CanonicalAnnualCompletionSource,
  projectCanonicalAnnualCompletion,
} from '../../src/lib/annual-completion-result.js';

function source(
  overrides: Partial<CanonicalAnnualCompletionSource> = {},
): CanonicalAnnualCompletionSource {
  return {
    session: { id: 'annual-real-2027', mode: 'REAL', bidYear: 2027 },
    completion: {
      commandId: 'completion-command-001',
      revision: 12,
      completedAtMs: 1_800_000_000_000,
      receiptIntegrity: 'VERIFIED',
    },
    frozen: {
      ruleBookVersion: '2027.1',
      topologyReference: 'topology-2027.1',
      staffingReference: 'staffing-2027.1',
      members: [
        { memberId: 101, rank: 'FF' },
        { memberId: 202, rank: 'FF' },
      ],
      positions: [
        {
          id: 'P-ENGINE-1',
          shift: 'A',
          station: '1',
          unit: 'Engine',
          position: 'Firefighter',
          specialty: null,
        },
        {
          id: 'P-RESCUE-1',
          shift: 'B',
          station: '2',
          unit: 'Rescue',
          position: 'Rescue Firefighter',
          specialty: 'RESCUE',
        },
        {
          id: 'P-RESCUE-2',
          shift: 'B',
          station: '2',
          unit: 'Rescue',
          position: 'Rescue Firefighter',
          specialty: 'RESCUE',
        },
      ],
    },
    state: {
      ...emptyBidSessionState('annual-real-2027'),
      currentPhase: 'complete',
      lastSeq: 12,
      fills: {
        'P-ENGINE-1': { memberId: 101, ordinal: 1, bidId: 'award-original' },
        'P-RESCUE-1': { memberId: 202, ordinal: 2, bidId: 'award-final' },
      },
      aDay: {
        groupCaps: {
          A: {
            G1: { min: 0, max: 10, officersRequired: 0 },
            G2: { min: 0, max: 10, officersRequired: 0 },
            G3: { min: 0, max: 10, officersRequired: 0 },
            G4: { min: 0, max: 10, officersRequired: 0 },
          },
          B: {
            G1: { min: 0, max: 10, officersRequired: 0 },
            G2: { min: 0, max: 10, officersRequired: 0 },
            G3: { min: 0, max: 10, officersRequired: 0 },
            G4: { min: 0, max: 10, officersRequired: 0 },
          },
          C: {
            G1: { min: 0, max: 10, officersRequired: 0 },
            G2: { min: 0, max: 10, officersRequired: 0 },
            G3: { min: 0, max: 10, officersRequired: 0 },
            G4: { min: 0, max: 10, officersRequired: 0 },
          },
        },
        weekdayCaps: {},
        picks: [
          {
            memberId: 101,
            shift: 'A',
            aDay: 'G1',
            pickedAtMs: 1_799_999_999_000,
            forced: false,
            adminActorId: null,
          },
          {
            memberId: 202,
            shift: 'B',
            aDay: 'G2',
            pickedAtMs: 1_799_999_999_001,
            forced: false,
            adminActorId: null,
          },
        ],
        bidOrder: [101, 202],
        cursor: 2,
        phase1: [
          [101, { positionId: 'P-ENGINE-1', shift: 'A' }],
          [202, { positionId: 'P-RESCUE-1', shift: 'B' }],
        ],
      },
      annual: {
        preferenceSheets: [],
        contactAttempts: [],
        unresolvedMemberIds: [],
        returnedAtCurrentSequence: [],
        returningMemberId: null,
        checkpoint: null,
        completion: { readyForFinalizationAtMs: 1_800_000_000_000, actorMemberId: 99 },
      },
    },
    amendmentLinks: [{ originalBidId: 'award-superseded', replacementBidId: 'award-final' }],
    ...overrides,
  };
}

describe('canonical annual completion projection', () => {
  it('uses normal REAL commands, A-Day picks, amendment, and completion as the Post-Bid source', () => {
    const policy: FrozenLiveBidPolicy = {
      v: 1,
      policyRevision: 'annual-real-policy',
      stages: [
        {
          id: 'annual',
          label: 'Annual',
          order: 0,
          memberIds: [101, 202, 303],
          opportunityPositionIds: ['P-ENGINE-1', 'P-RESCUE-1', 'P-RESCUE-2'],
          kind: 'FIREFIGHTER',
        },
      ],
      dispositions: [],
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
      aDayPolicyReference: 'a-day-2027',
      transitionPolicyReference: null,
      publicationPolicyReference: null,
      annualOperations: {
        v: 1,
        stageOrder: ['annual'],
        requiredTopologyPositionIds: ['P-ENGINE-1', 'P-RESCUE-1', 'P-RESCUE-2'],
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
    const command = (
      type: LiveBidCommand['type'],
      expectedSeq: number,
      extra: Record<string, unknown> = {},
    ): LiveBidCommand =>
      ({
        v: 1,
        type,
        commandId: `00000000-0000-4000-8000-${String(expectedSeq + 1).padStart(12, '0')}`,
        bidSessionId: 'annual-real-2027',
        expectedSeq,
        actor: { id: 99, role: 'admin' },
        reason: 'Annual completion integration proof',
        evidenceReference: null,
        ...extra,
      }) as LiveBidCommand;
    let state: BidSessionState = {
      ...emptyBidSessionState('annual-real-2027'),
      currentPhase: 'position_bid' as const,
      currentBidderId: 101,
      bidOrder: [
        { ordinal: 1, memberId: 101, pool: 'FF' as const, stageId: 'annual' },
        { ordinal: 2, memberId: 202, pool: 'FF' as const, stageId: 'annual' },
      ],
      live: {
        currentStageId: 'annual',
        completedStageIds: [],
        pausedPhase: null,
        lastSelectionBidId: null,
        dispositions: [],
      },
    };
    const first = reduceLiveBidCommand(
      state,
      policy,
      command('live.record_selection', 0, { memberId: 101, positionId: 'P-ENGINE-1' }),
      100,
      'award-1',
    );
    if (!first.ok) throw new Error(first.code);
    const second = reduceLiveBidCommand(
      first.state,
      policy,
      command('live.record_selection', 1, { memberId: 202, positionId: 'P-RESCUE-1' }),
      101,
      'award-2',
    );
    if (!second.ok) throw new Error(second.code);
    const amended = reduceLiveBidCommand(
      second.state,
      policy,
      command('live.amend_selection', 2, {
        memberId: 202,
        fromPositionId: 'P-RESCUE-1',
        toPositionId: 'P-RESCUE-2',
      }),
      102,
      'award-3',
    );
    if (!amended.ok) throw new Error(amended.code);
    const members: Member[] = [101, 202].map((memberId) => ({
      employeeId: String(memberId),
      firstName: 'Member',
      lastName: String(memberId),
      rank: 'FF',
      rscSeniority: memberId,
      rankSeniority: memberId,
      isProbationary: false,
      credentials: [],
    }));
    state = transitionToPhase2(
      amended.state,
      {
        members,
        phase1Order: [101, 202],
        phase1Picks: [
          { memberId: 101, positionId: 'P-ENGINE-1', shift: 'D' },
          { memberId: 202, positionId: 'P-RESCUE-2', shift: 'D' },
        ],
      },
      103,
    );
    const firstADay = handleSubmitADayPick(
      state,
      { senderMemberId: 101, aDay: 'MON', idempotencyKey: 'a-day-1', members },
      104,
    );
    if (firstADay.kind !== 'accepted') throw new Error(firstADay.code);
    const secondADay = handleSubmitADayPick(
      firstADay.newState,
      { senderMemberId: 202, aDay: 'TUE', idempotencyKey: 'a-day-2', members },
      105,
    );
    if (secondADay.kind !== 'accepted') throw new Error(secondADay.code);
    const completed = reduceLiveBidCommand(
      secondADay.newState,
      policy,
      command('live.complete_session', secondADay.newState.lastSeq),
      106,
      'completion',
    );
    if (!completed.ok) throw new Error(completed.code);

    const result = projectCanonicalAnnualCompletion(
      source({
        state: completed.state,
        completion: {
          commandId: 'completion',
          revision: completed.state.lastSeq,
          completedAtMs: 106,
          receiptIntegrity: 'VERIFIED',
        },
        amendmentLinks: [{ originalBidId: 'award-2', replacementBidId: 'award-3' }],
      }),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.futureRoster.map((row) => row.memberId)).toEqual([101, 202]);
    expect(
      result.value.participants.find((participant) => participant.positionId === 'P-RESCUE-2'),
    ).toMatchObject({
      memberId: 202,
      aDay: 'TUE',
      amendment: { originalBidId: 'award-2', replacementBidId: 'award-3' },
    });
    const replayed = projectCanonicalAnnualCompletion(
      source({
        state: JSON.parse(JSON.stringify(completed.state)) as BidSessionState,
        completion: {
          commandId: 'completion',
          revision: completed.state.lastSeq,
          completedAtMs: 106,
          receiptIntegrity: 'VERIFIED',
        },
        amendmentLinks: [{ originalBidId: 'award-2', replacementBidId: 'award-3' }],
      }),
    );
    expect(replayed).toEqual(result);
  });

  it('hands a REAL completed annual result to Post-Bid with final A-Day and amendment provenance only', () => {
    const result = projectCanonicalAnnualCompletion(source());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.participants).toEqual([
      expect.objectContaining({ memberId: 101, positionId: 'P-ENGINE-1', aDay: 'G1' }),
      expect.objectContaining({
        memberId: 202,
        positionId: 'P-RESCUE-1',
        aDay: 'G2',
        amendment: { originalBidId: 'award-superseded', replacementBidId: 'award-final' },
      }),
    ]);
    expect(result.value.futureRoster).toEqual([
      {
        memberId: 101,
        shift: 'A',
        station: '1',
        unit: 'Engine',
        position: 'Firefighter',
        aDay: 'G1',
      },
      {
        memberId: 202,
        shift: 'B',
        station: '2',
        unit: 'Rescue',
        position: 'Rescue Firefighter',
        aDay: 'G2',
      },
    ]);
  });

  it('fails closed for unfinished, mock, unresolved, or incomplete A-Day canonical state', () => {
    expect(
      projectCanonicalAnnualCompletion(
        source({ session: { id: 'annual-mock', mode: 'MOCK', bidYear: 2027 } }),
      ),
    ).toEqual({ ok: false, code: 'REAL_COMPLETION_REQUIRED', unresolvedMemberIds: [] });

    const unresolved = source();
    const annual = unresolved.state.annual;
    if (annual === null || annual === undefined) throw new Error('fixture annual state missing');
    unresolved.state.annual = { ...annual, unresolvedMemberIds: [303] };
    expect(projectCanonicalAnnualCompletion(unresolved)).toEqual({
      ok: false,
      code: 'UNRESOLVED_MEMBERS_BLOCK_TRANSITION',
      unresolvedMemberIds: [303],
    });

    const missingADay = source();
    const aDay = missingADay.state.aDay;
    if (aDay === null) throw new Error('fixture A-Day state missing');
    missingADay.state.aDay = {
      ...aDay,
      picks: aDay.picks.slice(0, 1),
    };
    expect(projectCanonicalAnnualCompletion(missingADay)).toEqual({
      ok: false,
      code: 'FINAL_A_DAY_MISSING',
      unresolvedMemberIds: [],
    });
  });
});
