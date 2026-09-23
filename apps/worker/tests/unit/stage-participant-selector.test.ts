import {
  BidDispositionSchema,
  type BidEvaluation,
  BidEvaluationSchema,
  type FrozenBidOrderingAuthority,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  StageParticipantSourceDefinitionsSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { computeBidEvaluationStageOrder } from '../../src/lib/live-bid-policy.js';
import {
  compileFrozenStageParticipants,
  compileStageParticipantsFromPinnedEvaluation,
  resolveStageParticipantMembership,
} from '../../src/lib/stage-participant-selector.js';

function executionPolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-adaptive-stage-policy',
    stages: [
      {
        id: 'CAPTAINS',
        label: 'Synthetic captains',
        order: 0,
        memberIds: [10001],
        opportunityPositionIds: ['synthetic-captain-seat'],
        kind: 'CAPTAIN',
      },
      {
        id: 'FIREFIGHTERS',
        label: 'Synthetic firefighters',
        order: 1,
        memberIds: [10004],
        opportunityPositionIds: ['synthetic-firefighter-seat'],
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
      actorMemberIds: [10001],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  });
}

function pinnedEvaluation(): BidEvaluation {
  return BidEvaluationSchema.parse({
    ruleBookVersion: 'synthetic.1',
    positionTemplateVersion: 'synthetic.1',
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
    },
    credentialEvaluationOn: '2027-01-01',
    capturedAtMs: Date.parse('2027-01-02T12:00:00.000Z'),
    members: [
      {
        memberId: 10001,
        pool: 'OFC',
        rscSeniority: 20,
        rankSeniority: 2,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'CPT',
        isProbationary: false,
        credentialNames: [],
      },
      {
        memberId: 10002,
        pool: 'OFC',
        rscSeniority: 10,
        rankSeniority: 1,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'CPT',
        isProbationary: false,
        credentialNames: [],
      },
      {
        memberId: 10003,
        pool: 'EXCLUDED',
        rscSeniority: 1,
        rankSeniority: 0,
        exclusionReason: 'MEMBER_NOT_ACTIVE',
        authoritativeAssignmentId: null,
        rank: 'CPT',
        isProbationary: false,
        credentialNames: [],
      },
      {
        memberId: 10004,
        pool: 'FF',
        rscSeniority: 5,
        rankSeniority: 1,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
      },
    ],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: 'synthetic.1',
          positionId: 'synthetic-captain-seat',
          templateVersion: 'synthetic.1',
          requiredCriteriaJson: '[]',
          pointsPreferenceJson: '[]',
          tieBreakChainJson: '[]',
        },
      ],
      positions: [
        {
          id: 'synthetic-captain-seat',
          templateVersion: 'synthetic.1',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '7',
          unit: 'Synthetic Engine',
          rankRequired: 'CPT',
          positionName: 'Synthetic captain',
        },
      ],
    },
  });
}

const sources = () =>
  StageParticipantSourceDefinitionsSchema.parse([
    {
      stageId: 'CAPTAINS',
      sourceRef: 'synthetic-policy:captain-stage',
      participantSource: {
        type: 'FILTER',
        active: true,
        bidParticipation: 'BIDDABLE',
        ranks: ['CPT'],
      },
      ordering: [
        { key: 'RANK_SENIORITY', direction: 'ASC' },
        { key: 'RSC_SENIORITY', direction: 'ASC' },
      ],
    },
    {
      stageId: 'FIREFIGHTERS',
      sourceRef: 'synthetic-policy:firefighter-stage',
      participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10004] },
      ordering: [
        { key: 'RANK_SENIORITY', direction: 'ASC' },
        { key: 'RSC_SENIORITY', direction: 'ASC' },
      ],
    },
  ]);

function orderingAuthority(
  comparator = [
    { key: 'RANK_SENIORITY' as const, direction: 'ASC' as const },
    { key: 'RSC_SENIORITY' as const, direction: 'ASC' as const },
  ],
): FrozenBidOrderingAuthority {
  return {
    v: 1,
    comparator,
    sourceDecision: {
      issueId: 'synthetic-governing-ordering-decision',
      effectiveOn: '2027-01-01',
    },
  };
}

describe('adaptive stage participant compiler', () => {
  it('keeps a legacy explicit-member policy unchanged when no adaptive source exists', () => {
    const policy = executionPolicy();
    const result = compileStageParticipantsFromPinnedEvaluation({
      pinnedEvaluation: pinnedEvaluation(),
      executionPolicy: policy,
      stageParticipantSources: undefined,
    });

    expect(result).toMatchObject({ ok: true, kind: 'legacy_explicit_members', provenance: [] });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.executionPolicy).toEqual(policy);
  });

  it('resolves typed selectors against a pinned Department evaluation and records provenance', () => {
    const evaluation = pinnedEvaluation();
    const result = compileStageParticipantsFromPinnedEvaluation({
      pinnedEvaluation: evaluation,
      executionPolicy: executionPolicy(),
      stageParticipantSources: sources(),
      orderingAuthority: orderingAuthority(),
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.executionPolicy.stages.map((stage) => [stage.id, stage.memberIds])).toEqual([
      ['CAPTAINS', [10002, 10001]],
      ['FIREFIGHTERS', [10004]],
    ]);
    expect(result.executionPolicy.stages[0]?.participantProvenance).toEqual({
      v: 1,
      stageId: 'CAPTAINS',
      sourceRef: 'synthetic-policy:captain-stage',
      participantSource: {
        type: 'FILTER',
        active: true,
        bidParticipation: 'BIDDABLE',
        ranks: ['CPT'],
      },
      ordering: [
        { key: 'RANK_SENIORITY', direction: 'ASC' },
        { key: 'RSC_SENIORITY', direction: 'ASC' },
      ],
      orderingAuthority: orderingAuthority(),
      pinnedEvaluationCapturedAtMs: evaluation.capturedAtMs,
      resolvedMemberIds: [10002, 10001],
    });
    expect(result.executionPolicy.stages[0]?.memberIds).not.toContain(10003);
  });

  it('scopes FILTER-backed population completeness to the ranks declared by the typed policy', () => {
    const evaluation = pinnedEvaluation();
    const captain = evaluation.members[0];
    if (!captain) throw new Error('Synthetic captain required');
    evaluation.members.push({
      ...captain,
      memberId: 10005,
      rank: 'DC',
      rscSeniority: 30,
      rankSeniority: 1,
    });

    const result = resolveStageParticipantMembership({
      pinnedEvaluation: evaluation,
      executionPolicy: executionPolicy(),
      stageParticipantSources: sources(),
    });

    expect(result).toMatchObject({ ok: true, kind: 'resolved_typed_sources' });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.stages.flatMap((stage) => stage.matchedMemberIds)).not.toContain(10005);
  });

  it('keeps explicit-only policies fail-closed for every pinned bid participant', () => {
    const evaluation = pinnedEvaluation();
    const captain = evaluation.members[0];
    if (!captain) throw new Error('Synthetic captain required');
    evaluation.members.push({
      ...captain,
      memberId: 10005,
      rank: 'DC',
      rscSeniority: 30,
      rankSeniority: 1,
    });
    const explicitOnly = sources().map((definition) => ({
      ...definition,
      participantSource: {
        type: 'EXPLICIT_MEMBERS' as const,
        memberIds: definition.stageId === 'CAPTAINS' ? [10001, 10002] : [10004],
      },
    }));

    expect(
      resolveStageParticipantMembership({
        pinnedEvaluation: evaluation,
        executionPolicy: executionPolicy(),
        stageParticipantSources: explicitOnly,
      }),
    ).toMatchObject({
      ok: false,
      code: 'stage_authoring_population_incomplete',
      memberIds: [10005],
    });
  });

  it('applies named filter inclusions and exclusions only to the pinned evaluation before freezing provenance', () => {
    const definitions = sources();
    const captains = definitions[0];
    const firefighters = definitions[1];
    if (!captains || !firefighters) throw new Error('Synthetic stage sources required');
    definitions[0] = {
      ...captains,
      participantSource: {
        type: 'FILTER',
        active: true,
        bidParticipation: 'BIDDABLE',
        ranks: ['CPT'],
        includeMemberIds: [10004],
        excludeMemberIds: [10001],
      },
    };
    definitions[1] = {
      ...firefighters,
      participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10001] },
    };

    const result = compileStageParticipantsFromPinnedEvaluation({
      pinnedEvaluation: pinnedEvaluation(),
      executionPolicy: executionPolicy(),
      stageParticipantSources: definitions,
      orderingAuthority: orderingAuthority(),
    });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.executionPolicy.stages.map((stage) => [stage.id, stage.memberIds])).toEqual([
      ['CAPTAINS', [10004, 10002]],
      ['FIREFIGHTERS', [10001]],
    ]);
    expect(result.provenance[0]?.participantSource).toMatchObject({
      type: 'FILTER',
      includeMemberIds: [10004],
      excludeMemberIds: [10001],
    });
  });

  it('fails closed when a named filter exception is absent from the pinned evaluation', () => {
    const definitions = sources();
    const captains = definitions[0];
    if (!captains) throw new Error('Synthetic captain source required');
    definitions[0] = {
      ...captains,
      participantSource: {
        type: 'FILTER',
        active: true,
        bidParticipation: 'BIDDABLE',
        ranks: ['CPT'],
        includeMemberIds: [99999],
      },
    };

    expect(
      resolveStageParticipantMembership({
        pinnedEvaluation: pinnedEvaluation(),
        executionPolicy: executionPolicy(),
        stageParticipantSources: definitions,
      }),
    ).toMatchObject({
      ok: false,
      code: 'stage_authoring_member_not_in_pinned_evaluation',
      stageId: 'CAPTAINS',
      memberIds: [99999],
    });
  });

  it('resolves typed membership for preview but refuses to compile an unresolved comparator into execution order', () => {
    const rankRequested = sources();
    const captains = rankRequested[0];
    if (!captains) throw new Error('Synthetic captain source required');
    rankRequested[0] = {
      ...captains,
      ordering: [{ key: 'RANK_SENIORITY', direction: 'DESC' }],
    };

    const membership = resolveStageParticipantMembership({
      pinnedEvaluation: pinnedEvaluation(),
      executionPolicy: executionPolicy(),
      stageParticipantSources: rankRequested,
    });
    if (!membership.ok) throw new Error(JSON.stringify(membership));
    expect(membership.stages[0]?.matchedMemberIds).toEqual([10001, 10002]);
    expect(membership.stages[0]?.displayOrder).toBe('MEMBER_ID_ASC');
    expect(
      compileFrozenStageParticipants({
        membership,
        executionPolicy: executionPolicy(),
      }),
    ).toMatchObject({ ok: false, code: 'stage_authoring_ordering_authority_unresolved' });
    expect(
      compileStageParticipantsFromPinnedEvaluation({
        pinnedEvaluation: pinnedEvaluation(),
        executionPolicy: executionPolicy(),
        stageParticipantSources: rankRequested,
      }),
    ).toMatchObject({ ok: false, code: 'stage_authoring_ordering_authority_unresolved' });
  });

  it('uses a typed comparator only when its resolved source-decision identity is supplied', () => {
    const authority = orderingAuthority();
    const result = compileStageParticipantsFromPinnedEvaluation({
      pinnedEvaluation: pinnedEvaluation(),
      executionPolicy: executionPolicy(),
      stageParticipantSources: sources(),
      orderingAuthority: authority,
    });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.executionPolicy.stages[0]?.participantProvenance?.orderingAuthority).toEqual(
      authority,
    );
  });

  it('keeps resolved member ids after a later current-roster change', () => {
    const evaluation = pinnedEvaluation();
    const result = compileStageParticipantsFromPinnedEvaluation({
      pinnedEvaluation: evaluation,
      executionPolicy: executionPolicy(),
      stageParticipantSources: sources(),
      orderingAuthority: orderingAuthority(),
    });
    if (!result.ok) throw new Error(JSON.stringify(result));

    const currentRoster = structuredClone(evaluation);
    const currentCaptain = currentRoster.members[0];
    const currentSecondCaptain = currentRoster.members[1];
    if (!currentCaptain || !currentSecondCaptain)
      throw new Error('Synthetic roster requires captains');
    currentRoster.members[0] = {
      ...currentCaptain,
      pool: 'EXCLUDED',
      exclusionReason: 'MEMBER_NOT_ACTIVE',
    };
    currentRoster.members.push({
      ...currentSecondCaptain,
      memberId: 19999,
      rscSeniority: 0,
      rankSeniority: 0,
    });

    expect(currentRoster.members.filter((member) => member.pool !== 'EXCLUDED')).toHaveLength(3);
    expect(result.executionPolicy.stages[0]?.memberIds).toEqual([10002, 10001]);
    expect(result.executionPolicy.stages[0]?.participantProvenance?.resolvedMemberIds).toEqual([
      10002, 10001,
    ]);
    expect(computeBidEvaluationStageOrder(evaluation, result.executionPolicy)).toEqual({
      ok: true,
      entries: [
        { ordinal: 1, memberId: 10002, stageId: 'CAPTAINS' },
        { ordinal: 2, memberId: 10001, stageId: 'CAPTAINS' },
        { ordinal: 3, memberId: 10004, stageId: 'FIREFIGHTERS' },
      ],
    });
  });

  it('fails closed instead of inventing a member-id tiebreak for underspecified ordering', () => {
    const evaluation = pinnedEvaluation();
    const secondCaptain = evaluation.members[1];
    if (!secondCaptain) throw new Error('Synthetic evaluation requires a second captain');
    evaluation.members[1] = {
      ...secondCaptain,
      rankSeniority: 2,
      rscSeniority: 20,
    };
    const tieSources = sources();
    const captainSource = tieSources[0];
    if (!captainSource) throw new Error('Synthetic sources require a captain stage');
    tieSources[0] = {
      ...captainSource,
      ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
    };

    expect(
      compileStageParticipantsFromPinnedEvaluation({
        pinnedEvaluation: evaluation,
        executionPolicy: executionPolicy(),
        stageParticipantSources: tieSources,
        orderingAuthority: orderingAuthority([{ key: 'RANK_SENIORITY', direction: 'ASC' }]),
      }),
    ).toMatchObject({ ok: false, code: 'stage_authoring_ordering_tie', stageId: 'CAPTAINS' });
  });
});
