import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import type { BidSessionState } from '../../src/durable/bid-session-state.js';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { evaluateFrozenADays } from '../../src/lib/frozen-a-day.js';

// Deferred early-award picks replay in (pickedAtMs, phase-2 order). Validity
// under count-based capacity/scoped limits must not depend on that order.
const DEFERRED = ['p1', 'p2'];
const IDS = ['p1', 'p2', 'p3', 'p4'];

function fixture(maximum: number) {
  const parsed = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: 'synthetic.1',
    positionTemplateVersion: 'synthetic.1',
    ruleBookRevision: 1,
    configurationRevision: 1,
    capturedAtMs: 1,
    credentialEvaluationOn: '2027-01-01',
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      livePolicy: {
        v: 1,
        policyRevision: 'synthetic-deferred-replay',
        stages: [
          {
            id: 'ff',
            label: 'FF',
            order: 0,
            kind: 'FIREFIGHTER',
            memberIds: [1, 2, 3, 4],
            opportunityPositionIds: IDS,
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
        actionPermissions: LiveBidActionSchema.options.map((action) => ({
          action,
          actorMemberIds: [99],
        })),
        specialtyCatalogReference: null,
        aDayPolicyReference: null,
        transitionPolicyReference: null,
        publicationPolicyReference: null,
        annualOperations: {
          v: 1,
          stageOrder: ['ff'],
          requiredTopologyPositionIds: IDS,
          specialties: [],
          contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: null,
            max: null,
            captainDcMax: null,
            specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
            execution: {
              timing: 'SIMULTANEOUS',
              timingExceptions: [
                {
                  id: 'early',
                  label: 'Specialized award A-Day at ordinary rank turn',
                  timing: 'AFTER_POSITION_SELECTION',
                  sourceRef: 'synthetic',
                  positionIds: DEFERRED,
                  profileIds: [],
                },
              ],
              officersPerGroup: null,
              sourceRef: 'synthetic',
              constraints: [
                {
                  id: 'scoped',
                  label: 'Synthetic DE/Marine limit',
                  sourceRef: 'synthetic',
                  maximum,
                  positionIds: IDS,
                  memberIds: [],
                  ranks: [],
                  shifts: ['A'],
                },
              ],
            },
          },
        },
      },
    },
    members: [1, 2, 3, 4].map((memberId) => ({
      memberId,
      pool: 'FF',
      rscSeniority: memberId,
      rankSeniority: memberId,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      rank: 'FF',
      isProbationary: false,
      credentialNames: [],
    })),
    ruleBookMaterial: {
      v: 1,
      positions: IDS.map((id) => ({
        id,
        templateVersion: 'synthetic.1',
        shift: 'A',
        station: 'Synthetic',
        unit: 'Synthetic',
        rankRequired: 'FF',
        positionName: id,
        bidParticipation: 'BIDDABLE',
        isExcludedFromCount: false,
      })),
      rules: IDS.map((positionId) => ({
        ruleBookVersion: 'synthetic.1',
        templateVersion: 'synthetic.1',
        positionId,
        requiredCriteriaJson: '[]',
        pointsPreferenceJson: '[]',
        tieBreakChainJson: '[]',
      })),
    },
  });
  if (parsed.v !== 3) throw new Error('Expected V3');
  return parsed;
}

type Pick = { memberId: number; aDay: 'G1' | 'G2' | 'G3' | 'G4'; pickedAtMs: number };
function state(picks: Pick[]): BidSessionState {
  return {
    ...emptyBidSessionState('synthetic'),
    currentPhase: 'position_bid',
    bidOrder: [1, 2, 3, 4].map((memberId) => ({
      ordinal: memberId,
      memberId,
      pool: 'FF' as const,
      stageId: 'ff',
    })),
    fills: {
      p1: { memberId: 1, ordinal: 1, bidId: 'early-1' },
      p2: { memberId: 2, ordinal: 2, bidId: 'early-2' },
      p3: { memberId: 3, ordinal: 3, bidId: 'own-3', aDay: 'G4' },
      p4: { memberId: 4, ordinal: 4, bidId: 'own-4', aDay: 'G3' },
    },
    aDay: {
      groupCaps: { A: {}, B: {}, C: {} } as never,
      weekdayCaps: {},
      picks: picks.map((pick) => ({
        ...pick,
        shift: 'A' as const,
        forced: false,
        adminActorId: 99,
      })),
      bidOrder: [],
      cursor: 0,
      phase1: [],
    },
  };
}
const evaluate = (maximum: number, picks: Pick[], finalize = false) =>
  evaluateFrozenADays(fixture(maximum), state(picks), {
    nowMs: 5_000,
    actorId: 99,
    forced: false,
    finalize,
  });
const sortedPicks = (result: ReturnType<typeof evaluate>) =>
  result.ok
    ? [...(result.aDay?.picks ?? [])].map((pick) => `${pick.memberId}:${pick.aDay}`).sort()
    : result.code;

describe('deferred early-award A-Day replay determinism', () => {
  it('accepts the same valid set identically for same-millisecond and reversed persisted order', () => {
    const a: Pick = { memberId: 1, aDay: 'G1', pickedAtMs: 100 };
    const b: Pick = { memberId: 2, aDay: 'G2', pickedAtMs: 100 };
    const forward = evaluate(1, [a, b]);
    const reversed = evaluate(1, [b, a]);
    const laterFirst = evaluate(1, [
      { ...b, pickedAtMs: 50 },
      { ...a, pickedAtMs: 200 },
    ]);
    expect(forward).toMatchObject({ ok: true, nextDeferredMemberId: null });
    expect(sortedPicks(forward)).toEqual(['1:G1', '2:G2', '3:G4', '4:G3']);
    expect(sortedPicks(reversed)).toEqual(sortedPicks(forward));
    expect(sortedPicks(laterFirst)).toEqual(sortedPicks(forward));
    expect(reversed).toEqual(forward);
  });

  it('rejects a set exceeding a scoped limit regardless of replay order or timestamps', () => {
    const a: Pick = { memberId: 1, aDay: 'G4', pickedAtMs: 100 };
    const b: Pick = { memberId: 2, aDay: 'G2', pickedAtMs: 100 };
    for (const picks of [
      [a, b],
      [b, a],
      [
        { ...a, pickedAtMs: 1 },
        { ...b, pickedAtMs: 2 },
      ],
      [
        { ...a, pickedAtMs: 2 },
        { ...b, pickedAtMs: 1 },
      ],
    ])
      expect(evaluate(1, picks)).toEqual({ ok: false, code: 'SCOPED_A_DAY_MAXIMUM' });
  });

  it('keeps an unavailable earlier winner owed for post-position resolution after a later winner records', () => {
    const later = evaluate(1, [{ memberId: 2, aDay: 'G2', pickedAtMs: 100 }]);
    expect(later).toMatchObject({ ok: true, nextDeferredMemberId: 1 });
    expect(evaluate(1, [{ memberId: 2, aDay: 'G2', pickedAtMs: 100 }], true)).toEqual({
      ok: false,
      code: 'A_DAY_DEFERRED_SELECTION_INCOMPLETE',
    });
    const resolved = evaluate(1, [
      { memberId: 2, aDay: 'G2', pickedAtMs: 100 },
      { memberId: 1, aDay: 'G1', pickedAtMs: 900 },
    ]);
    expect(resolved).toMatchObject({ ok: true, nextDeferredMemberId: null });
  });

  it('reconstructs identically from its own persisted output', () => {
    const first = evaluate(1, [
      { memberId: 2, aDay: 'G2', pickedAtMs: 100 },
      { memberId: 1, aDay: 'G1', pickedAtMs: 100 },
    ]);
    if (!first.ok || first.aDay === null) throw new Error('expected allocation');
    const restarted = JSON.parse(JSON.stringify(first.aDay)) as NonNullable<
      BidSessionState['aDay']
    >;
    const again = evaluateFrozenADays(
      fixture(1),
      { ...state([]), aDay: restarted },
      { nowMs: 9_999, actorId: 99, forced: false, finalize: false },
    );
    expect(again).toEqual(first);
  });
});
