import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenAnnualOperationsPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { initializeAnnualOperations } from '../../src/lib/annual-bid-operations.js';
import { evaluateBidFallback } from '../../src/lib/bid-fallback.js';

type Fallback = NonNullable<FrozenAnnualOperationsPolicy['fallbackPolicies']>[number];
type Activation = NonNullable<Fallback['activation']>;

function fixture(
  activation: Activation | null = {
    v: 1,
    prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS',
    sourceRef: 'Synthetic approved no-volunteers condition',
  },
) {
  const policy = FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-timing',
    stages: [
      {
        id: 'ff',
        label: 'Ordinary Firefighters',
        order: 0,
        kind: 'FIREFIGHTER',
        memberIds: [1, 2],
        opportunityPositionIds: ['seat'],
      },
      {
        id: 'later',
        label: 'Later unrelated stage',
        order: 1,
        kind: 'LIEUTENANT',
        memberIds: [3],
        opportunityPositionIds: ['other'],
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: disposition === 'DEFER',
      returnStageId: disposition === 'DEFER' ? 'ff' : null,
      retainsLaterSelectionRights: disposition === 'DEFER' || disposition === 'UNREACHABLE',
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
      stageOrder: ['ff', 'later'],
      requiredTopologyPositionIds: ['seat', 'other'],
      specialties: [],
      fallbackPolicies: [
        {
          id: 'synthetic-fallback',
          label: 'Synthetic fallback',
          sourceRef: 'Synthetic qualification source',
          sourceDecisionId: 'synthetic-source',
          positionIds: ['seat'],
          tiers: [
            {
              id: 'forced',
              label: 'Qualified reverse order',
              mode: 'FORCED',
              eligibility: { kind: 'MINIMUM_QUALIFIED' },
              currentlyAssignedOnly: false,
              comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
            },
          ],
        },
      ],
      contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 10,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
      },
    },
  });
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
      livePolicy: policy,
    },
    members: [1, 2, 3].map((memberId) => ({
      memberId,
      pool: 'FF',
      rank: 'FF',
      rscSeniority: memberId,
      rankSeniority: memberId,
      isProbationary: false,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      credentialNames: ['Minimum'],
      currentBidPositionIds: [],
    })),
    ruleBookMaterial: {
      v: 1,
      positions: [
        {
          id: 'seat',
          templateVersion: 'synthetic.1',
          shift: 'A',
          station: '1',
          unit: 'Synthetic',
          rankRequired: 'FF',
          positionName: 'Synthetic',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
        },
      ],
      rules: [
        {
          ruleBookVersion: 'synthetic.1',
          templateVersion: 'synthetic.1',
          positionId: 'seat',
          requiredCriteriaJson: JSON.stringify({
            rank: ['FF'],
            credentials: ['Minimum'],
            custom: [],
          }),
          pointsPreferenceJson: JSON.stringify({ max: 0, items: [] }),
          tieBreakChainJson: JSON.stringify(['rsc_seniority']),
        },
      ],
    },
  });
  if (snapshot.v !== 3 || snapshot.settings.v !== 3) throw new Error('V3 fixture required');
  const fallback = snapshot.settings.livePolicy.annualOperations?.fallbackPolicies?.[0];
  if (!fallback) throw new Error('Fallback fixture required');
  if (activation) fallback.activation = activation;
  const state: BidSessionState & {
    live: NonNullable<BidSessionState['live']>;
    annual: NonNullable<BidSessionState['annual']>;
  } = {
    ...emptyBidSessionState('synthetic-timing'),
    currentPhase: 'position_bid' as const,
    currentBidderId: 1,
    bidOrder: [
      { ordinal: 1, memberId: 1, pool: 'FF' as const, stageId: 'ff' },
      { ordinal: 2, memberId: 2, pool: 'FF' as const, stageId: 'ff' },
      { ordinal: 3, memberId: 3, pool: 'FF' as const, stageId: 'later' },
    ],
    annual: initializeAnnualOperations({ preferenceSheets: [] }),
    live: {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    },
  };
  return {
    snapshot: { ...snapshot, settings: { ...snapshot.settings } },
    state,
    fallback,
    positionId: 'seat',
  };
}

function exhaustOrdinary(f: ReturnType<typeof fixture>) {
  if (!f.state.live) throw new Error('Progress required');
  f.state.queueCursor = 2;
  f.state.currentBidderId = 3;
  f.state.live.currentStageId = 'later';
  f.state.live.dispositions = [1, 2].map((memberId) => ({
    memberId,
    stageId: 'ff',
    disposition: 'DECLINED',
    reason: 'Declined ordinary opportunity',
    evidenceReference: null,
  }));
}

describe('server-authoritative fallback activation', () => {
  it('rejects an early forced candidate while a senior ordinary contender remains', () => {
    const f = fixture();
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: false,
      code: 'FALLBACK_ORDINARY_PATH_NOT_EXHAUSTED',
      blockingMemberIds: [1, 2],
    });
  });

  it('activates at the target opportunity exhaustion point without waiting for unrelated stages', () => {
    const f = fixture();
    exhaustOrdinary(f);
    expect(evaluateBidFallback(f)).toMatchObject({ ok: true, candidateMemberIds: [3, 2, 1] });
  });

  it('permits proven final-stage fallback after queue exhaustion and before annual completion is sealed', () => {
    const f = fixture();
    exhaustOrdinary(f);
    f.state.currentPhase = 'complete';
    f.state.currentBidderId = null;
    f.state.queueCursor = f.state.bidOrder.length;
    expect(evaluateBidFallback(f)).toMatchObject({ ok: true });
    f.state.annual = {
      ...f.state.annual,
      completion: { actorMemberId: 99, readyForFinalizationAtMs: 2 },
    };
    expect(evaluateBidFallback(f)).toMatchObject({ ok: false, code: 'ANNUAL_COMPLETION_SEALED' });
  });

  it('does not trust a completed-stage flag or queue cursor as a substitute for outcomes', () => {
    const f = fixture();
    f.state.queueCursor = 3;
    f.state.live.completedStageIds = ['ff'];
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: false,
      code: 'FALLBACK_ORDINARY_PATH_NOT_EXHAUSTED',
    });
  });

  it.each(['UNREACHABLE', 'DEFER'])(
    'does not treat %s as a qualified volunteer decline',
    (disposition) => {
      const f = fixture();
      exhaustOrdinary(f);
      const outcome = f.state.live.dispositions[0];
      if (!outcome) throw new Error('Ordinary outcome required');
      outcome.disposition = disposition;
      f.state.annual = { ...f.state.annual, unresolvedMemberIds: [1] };
      expect(evaluateBidFallback(f)).toMatchObject({
        ok: false,
        code: 'FALLBACK_ORDINARY_PATH_NOT_EXHAUSTED',
        blockingMemberIds: [1],
      });
    },
  );

  it('does not use a decline recorded for another stage', () => {
    const f = fixture();
    exhaustOrdinary(f);
    const outcome = f.state.live.dispositions[0];
    if (!outcome) throw new Error('Ordinary outcome required');
    outcome.stageId = 'later';
    expect(evaluateBidFallback(f)).toMatchObject({ ok: false, blockingMemberIds: [1] });
  });

  it('does not count an already awarded member as an available ordinary contender', () => {
    const f = fixture();
    exhaustOrdinary(f);
    f.state.live.dispositions = f.state.live.dispositions.filter((entry) => entry.memberId !== 1);
    f.state.fills.other = { memberId: 1, ordinal: 1, bidId: 'award' };
    expect(evaluateBidFallback(f)).toMatchObject({ ok: true, candidateMemberIds: [3, 2] });
  });

  it('rejects unknown timing with an administrator-decision condition', () => {
    const f = fixture(null);
    exhaustOrdinary(f);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: false,
      code: 'FALLBACK_TIMING_NEEDS_ADMIN_DECISION',
    });
  });

  it('preserves state and deterministic availability through JSON reconstruction', () => {
    const f = fixture();
    exhaustOrdinary(f);
    const before = JSON.stringify(f);
    const first = evaluateBidFallback(f);
    expect(evaluateBidFallback(JSON.parse(before))).toEqual(first);
    expect(JSON.stringify(f)).toBe(before);
  });

  it.each([
    [
      'fallback-designated-de',
      'PDF p7 Procedure12',
      ['103', '104', '202', '303', '304', '402', '707', '708'],
    ],
    [
      'fallback-rescue-float',
      'PDF p7 Procedure11b',
      ['213', '215', '701', '702', '703', '704', '705', '706'],
    ],
    ['fallback-fire-investigator', 'PDF p2 Procedure3e; Rules & Points!A176:C189', ['305']],
    ['fallback-main-airtech', 'PDF p4 Procedure7(a), final minimum-qualified sentence', ['203']],
    ['fallback-captain5', 'PDF p3 Procedure6b; Rules & Points!A3:C14; Points!BZ5:CE5', ['212']],
    [
      'fallback-marine-officer',
      'PDF pp4-6 Procedure8; user clarification2026-09-19 minimum-qualified only',
      ['601'],
    ],
  ])(
    'recognizes source-backed Version 11 timing for %s without changing immutable input',
    (id, sourceRef, suffixes) => {
      const f = fixture(null);
      const positionIds = ['A', 'B', 'C'].flatMap((shift) =>
        suffixes.map((suffix) => `${shift}${suffix}`),
      );
      const positionId = positionIds[0];
      if (!positionId) throw new Error('Reviewed target required');
      f.positionId = positionId;
      const sourceRule = f.snapshot.ruleBookMaterial.rules[0];
      const sourceStage = f.snapshot.settings.livePolicy.stages[0];
      if (!sourceRule || !sourceStage) throw new Error('Target rule and stage required');
      sourceRule.positionId = positionId;
      sourceStage.opportunityPositionIds = [positionId];
      f.snapshot.settings.livePolicy.policyRevision = 'final2026-july-source-reconciliation';
      f.snapshot.annualPolicyEvidence = {
        documentId: 'sealed-policy',
        documentRevision: 1,
        ruleBookVersion: 'synthetic.1',
        executablePolicyRevision: 'final2026-july-source-reconciliation',
        policyText: 'Final governing July 2026 Bid policy',
      };
      Object.assign(f.fallback, { id, sourceDecisionId: id, sourceRef, positionIds });
      const sourceTier = f.fallback.tiers[0];
      if (!sourceTier) throw new Error('Forced tier required');
      sourceTier.comparator = [{ key: 'DEPARTMENT_SERVICE_BID_ORDINAL', direction: 'DESC' }];
      f.snapshot.members = f.snapshot.members.map((member) => ({
        ...member,
        bidOrdinalEvidence: {
          datasetId: 'synthetic-reviewed-ordinals',
          sourceSha256: 'a'.repeat(64),
          timeInGrade: member.memberId,
          departmentService: member.memberId,
        },
      }));
      if (id === 'fallback-fire-investigator' || id === 'fallback-captain5') {
        const tier = f.fallback.tiers[0];
        if (!tier) throw new Error('Forced tier required');
        tier.currentlyAssignedOnly = true;
        f.snapshot.members = f.snapshot.members.map((member) => ({
          ...member,
          currentBidPositionIds: [positionId],
        }));
      }
      exhaustOrdinary(f);
      const before = JSON.stringify(f.snapshot);
      expect(evaluateBidFallback(f)).toMatchObject({ ok: true });
      expect(JSON.stringify(f.snapshot)).toBe(before);
      expect(f.fallback).not.toHaveProperty('activation');
      f.fallback.positionIds = [...positionIds, 'copied-source-unapproved-scope'];
      expect(evaluateBidFallback(f)).toMatchObject({
        ok: false,
        code: 'FALLBACK_TIMING_NEEDS_ADMIN_DECISION',
      });
      f.fallback.positionIds = positionIds;
      sourceTier.comparator = [{ key: 'RSC_SENIORITY', direction: 'DESC' }];
      expect(evaluateBidFallback(f)).toMatchObject({
        ok: false,
        code: 'FALLBACK_TIMING_NEEDS_ADMIN_DECISION',
      });
    },
  );

  it('requires the exact reviewed legacy source reference and policy revision', () => {
    const f = fixture(null);
    Object.assign(f.fallback, {
      id: 'fallback-designated-de',
      sourceDecisionId: 'fallback-designated-de',
      sourceRef: 'PDF p7 Procedure12 changed',
    });
    exhaustOrdinary(f);
    expect(evaluateBidFallback(f)).toMatchObject({
      ok: false,
      code: 'FALLBACK_TIMING_NEEDS_ADMIN_DECISION',
    });
  });
});
