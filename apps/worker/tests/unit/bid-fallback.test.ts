import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenAnnualOperationsPolicy,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { evaluateBidFallback } from '../../src/lib/bid-fallback.js';

type Fallback = NonNullable<FrozenAnnualOperationsPolicy['fallbackPolicies']>[number];
type Tier = Fallback['tiers'][number];
const tier = (id: string, overrides: Partial<Tier> = {}): Tier => ({
  id,
  label: id,
  mode: 'FORCED',
  eligibility: { kind: 'MINIMUM_QUALIFIED' },
  currentlyAssignedOnly: false,
  comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
  ...overrides,
});
function fixture(tiers: Tier[] = [tier('minimum-marine')]) {
  const fallback: Fallback = {
    id: 'marine',
    label: 'Synthetic Marine minimum',
    sourceRef: 'synthetic:marine-minimum-source',
    sourceDecisionId: 'marine-order-source',
    positionIds: ['marine-seat'],
    tiers,
  };
  const livePolicy = {
    v: 1,
    policyRevision: 'synthetic-fallback',
    stages: [
      {
        id: 'ff',
        label: 'Synthetic',
        order: 0,
        memberIds: [1, 2, 3],
        opportunityPositionIds: ['marine-seat'],
        kind: 'FIREFIGHTER',
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
      requiredTopologyPositionIds: ['marine-seat'],
      specialties: [],
      fallbackPolicies: [fallback],
      contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 10,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
      },
    },
  };
  const snapshot = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: 'synthetic.1',
    ruleBookRevision: 1,
    positionTemplateVersion: 'synthetic.1',
    configurationRevision: 1,
    capturedAtMs: 1,
    credentialEvaluationOn: '2027-01-01',
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      livePolicy,
    },
    members: [
      {
        memberId: 1,
        rscSeniority: 1,
        credentialNames: ['Marine minimum', 'Preference bonus', 'Basic'],
      },
      { memberId: 2, rscSeniority: 5, credentialNames: ['Marine minimum', 'Basic'] },
      { memberId: 3, rscSeniority: 9, credentialNames: ['Preference bonus', 'Basic'] },
    ].map((m) => ({
      ...m,
      pool: 'FF',
      rank: 'FF',
      rankSeniority: m.memberId,
      isProbationary: false,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      currentBidPositionIds: m.memberId === 1 ? ['marine-seat'] : [],
    })),
    ruleBookMaterial: {
      v: 1,
      positions: [
        {
          id: 'marine-seat',
          templateVersion: 'synthetic.1',
          shift: 'A',
          station: '1',
          unit: 'Synthetic Marine',
          rankRequired: 'FF',
          positionName: 'Synthetic Marine',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
        },
      ],
      rules: [
        {
          ruleBookVersion: 'synthetic.1',
          templateVersion: 'synthetic.1',
          positionId: 'marine-seat',
          requiredCriteriaJson: JSON.stringify({
            rank: ['FF'],
            credentials: ['Marine minimum'],
            custom: [],
          }),
          pointsPreferenceJson: JSON.stringify({
            max: 100,
            items: [{ credential: 'Preference bonus', points: 100 }],
          }),
          tieBreakChainJson: JSON.stringify(['points', 'rsc_seniority']),
        },
      ],
    },
  });
  if (snapshot.v !== 3) throw new Error('Expected V3');
  const state: BidSessionState = {
    ...emptyBidSessionState('synthetic'),
    live: {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    },
  };
  return { snapshot, state, positionId: 'marine-seat' };
}
function responded(f: ReturnType<typeof fixture>, tierId: string, memberIds: number[]) {
  if (!f.state.live) throw new Error('Expected live progress');
  f.state.live = {
    ...f.state.live,
    fallbackResponses: memberIds.map((memberId) => ({
      policyId: 'marine',
      tierId,
      positionId: 'marine-seat',
      memberId,
      outcome: 'DECLINE',
      reason: 'Synthetic declined offer',
      evidenceReference: 'synthetic:decline',
    })),
  };
}

describe('frozen fallback policy tiers', () => {
  it('requires reviewed full Days tour history and excludes members with a completed tour', () => {
    const f = fixture([
      tier('days-history', {
        historyPredicate: {
          kind: 'NO_COMPLETED_DAYS_BID_TOUR',
          sourceRef: 'synthetic Days vacancy clause',
        },
      }),
    ]);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: false,
      code: 'FALLBACK_DAYS_TOUR_HISTORY_REQUIRED',
    });
    for (const member of f.snapshot.members)
      member.bidTourEvidence = {
        recordId: `tour-${member.memberId}`,
        effectiveOn: '2026-01-01',
        completedDaysTour: member.memberId === 2,
        sourceRef: 'synthetic reviewed full tour record',
      };
    expect(evaluateBidFallback(f)).toMatchObject({ ok: true, candidateMemberIds: [1] });
    const first = f.snapshot.members[0];
    if (!first) throw new Error('Member required');
    first.bidTourEvidence = {
      recordId: 'unknown-tour',
      effectiveOn: '2026-01-01',
      completedDaysTour: null,
      sourceRef: 'synthetic missing tour review',
    };
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: false,
      code: 'FALLBACK_DAYS_TOUR_HISTORY_REQUIRED',
    });
  });
  it('offers voluntary-only term incumbents in voluntary tiers but never exposes them to a forced tier', () => {
    const f = fixture([tier('voluntary', { mode: 'VOLUNTARY' }), tier('forced')]);
    const member = f.snapshot.members.find((candidate) => candidate.memberId === 2);
    if (!member) throw new Error('Synthetic member required');
    member.termParticipation = {
      assignmentId: 'synthetic-retained-assignment',
      staffingPositionId: 'synthetic-retained-staffing',
      positionId: 'synthetic-retained-seat',
      termId: 'synthetic-term',
      evidenceId: 'synthetic-evidence',
      evidenceRevision: 1,
      sourceRef: 'synthetic:term-source',
      evaluatedOn: '2027-01-01',
      assignmentEffectiveFrom: '2026-01-01',
      assignmentEffectiveTo: null,
      memberMayLeave: true,
      protected: true,
      voluntaryOnly: true,
    };
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: true,
      mode: 'VOLUNTARY',
      candidateMemberIds: [2, 1],
    });
    responded(f, 'voluntary', [2, 1]);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: true,
      mode: 'FORCED',
      candidateMemberIds: [1],
    });
  });
  it('orders minimum-qualified Marine candidates by reverse ordinal, never preference points', () => {
    const result = evaluateBidFallback(fixture());
    expect(result).toMatchObject({
      ok: true,
      tierId: 'minimum-marine',
      candidateMemberIds: [2, 1],
      sourceRef: 'synthetic:marine-minimum-source',
      sourceDecisionId: 'marine-order-source',
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.eligibleMemberIds).not.toContain(3);
  });
  it('does not enter a lower tier until every eligible voluntary candidate responds', () => {
    const f = fixture([
      tier('current-voluntary', { mode: 'VOLUNTARY', currentlyAssignedOnly: true }),
      tier('minimum-forced'),
    ]);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: true,
      tierId: 'current-voluntary',
      candidateMemberIds: [1],
      exhausted: [],
    });
    responded(f, 'current-voluntary', [2]);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: true,
      tierId: 'current-voluntary',
      candidateMemberIds: [1],
    });
    responded(f, 'current-voluntary', [1]);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: true,
      tierId: 'minimum-forced',
      candidateMemberIds: [2, 1],
      exhausted: [
        {
          tierId: 'current-voluntary',
          eligibleMemberIds: [1],
          reason: 'ALL_ELIGIBLE_CANDIDATES_RESPONDED',
        },
      ],
    });
  });
  it('fails closed on tied or missing comparator facts', () => {
    const tied = fixture();
    tied.snapshot.members = tied.snapshot.members.map((m) => ({ ...m, rscSeniority: 1 }));
    expect(evaluateBidFallback(tied)).toMatchObject({ ok: false, code: 'STAGE_ORDERING_TIE' });
    const missing = fixture([
      tier('rank', { comparator: [{ key: 'RANK_SENIORITY', direction: 'DESC' }] }),
    ]);
    missing.snapshot.members = missing.snapshot.members.map((m) =>
      m.memberId === 2 ? { ...m, rankSeniority: null } : m,
    );
    expect(evaluateBidFallback(missing)).toMatchObject({
      ok: false,
      code: 'STAGE_ORDERING_FACT_MISSING',
    });
  });
  it('excludes already awarded and excluded members and refuses a filled target', () => {
    const f = fixture();
    f.state.fills.other = { memberId: 2, ordinal: 1, bidId: 'synthetic-award' };
    expect(evaluateBidFallback(f)).toMatchObject({ ok: true, candidateMemberIds: [1] });
    f.snapshot.members = f.snapshot.members.map((m) =>
      m.memberId === 1 ? { ...m, pool: 'EXCLUDED', exclusionReason: 'MEMBER_NOT_ACTIVE' } : m,
    );
    expect(evaluateBidFallback(f)).toMatchObject({ ok: false, code: 'FALLBACK_TIERS_EXHAUSTED' });
    f.state.fills['marine-seat'] = { memberId: 2, ordinal: 1, bidId: 'synthetic-award' };
    expect(evaluateBidFallback(f)).toEqual({ ok: false, code: 'POSITION_FILLED' });
  });
  it('requires frozen assignment evidence for currently-assigned tiers', () => {
    const f = fixture([tier('currently-assigned', { currentlyAssignedOnly: true })]);
    f.snapshot.members = f.snapshot.members.map(({ currentBidPositionIds: _ignored, ...m }) => m);
    expect(evaluateBidFallback(f)).toEqual({
      ok: false,
      code: 'FALLBACK_CURRENT_ASSIGNMENT_EVIDENCE_MISSING',
    });
  });
  it('uses an explicit lower tier for other roles only after minimum-qualified tiers exhaust', () => {
    const f = fixture([
      tier('minimum-voluntary', { mode: 'VOLUNTARY' }),
      tier('other-explicit', {
        eligibility: {
          kind: 'EXPLICIT_REQUIREMENTS',
          requirements: { ranks: ['FF'], credentials: ['Basic'], custom: [] },
        },
      }),
    ]);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: true,
      tierId: 'minimum-voluntary',
      candidateMemberIds: [2, 1],
    });
    responded(f, 'minimum-voluntary', [2, 1]);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: true,
      tierId: 'other-explicit',
      candidateMemberIds: [3, 2, 1],
    });
  });
});
