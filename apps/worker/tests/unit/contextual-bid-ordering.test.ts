import {
  BidDefinitionSourceDecisionSchema,
  BidDispositionSchema,
  type BidEvaluation,
  BidOrderingAuthorityRequestSchema,
  type BidOrderingComparator,
  type FrozenBidOrderingAuthority,
  FrozenBidOrderingAuthoritySchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  StageParticipantSourceDefinitionsSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { resolveFrozenBidOrderingAuthority } from '../../src/lib/bid-ordering-authority.js';
import { computeBidEvaluationStageOrder } from '../../src/lib/live-bid-policy.js';
import { compileStageParticipantsFromPinnedEvaluation } from '../../src/lib/stage-participant-selector.js';

const sourceDecision = { issueId: 'synthetic-contextual-order', effectiveOn: '2027-01-01' };
const rank: BidOrderingComparator = [{ key: 'RANK_SENIORITY', direction: 'ASC' }];
const rsc: BidOrderingComparator = [{ key: 'RSC_SENIORITY', direction: 'ASC' }];

function authority(reverse = false): Extract<FrozenBidOrderingAuthority, { v: 2 }> {
  const direction = reverse ? 'DESC' : 'ASC';
  return {
    v: 2,
    sourceDecision,
    stages: [
      { stageId: 'CAPTAINS', comparator: [{ key: 'RANK_SENIORITY', direction }] },
      { stageId: 'FIREFIGHTERS', comparator: [{ key: 'RSC_SENIORITY', direction }] },
    ],
  };
}

function pinnedEvaluation(): Pick<BidEvaluation, 'capturedAtMs' | 'members'> {
  return {
    capturedAtMs: Date.parse('2027-01-02T12:00:00.000Z'),
    members: [
      { memberId: 10001, rank: 'CPT', pool: 'OFC', rscSeniority: 1, rankSeniority: 2 },
      { memberId: 10002, rank: 'CPT', pool: 'OFC', rscSeniority: 2, rankSeniority: 1 },
      { memberId: 10003, rank: 'FF', pool: 'FF', rscSeniority: 1, rankSeniority: 2 },
      { memberId: 10004, rank: 'FF', pool: 'FF', rscSeniority: 2, rankSeniority: 1 },
    ].map((member) => ({
      ...member,
      rank: member.rank as 'CPT' | 'FF',
      pool: member.pool as 'OFC' | 'FF',
      exclusionReason: null,
      authoritativeAssignmentId: null,
      isProbationary: false,
      credentialNames: [],
    })),
  };
}

function policy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-contextual-order',
    stages: [
      {
        id: 'CAPTAINS',
        label: 'Synthetic captains',
        order: 0,
        kind: 'CAPTAIN',
        memberIds: [10001, 10002],
        opportunityPositionIds: ['synthetic-captain-seat'],
      },
      {
        id: 'FIREFIGHTERS',
        label: 'Synthetic firefighters',
        order: 1,
        kind: 'FIREFIGHTER',
        memberIds: [10003, 10004],
        opportunityPositionIds: ['synthetic-firefighter-seat'],
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

function sources(ordering = authority()) {
  return StageParticipantSourceDefinitionsSchema.parse(
    ordering.stages.map((stage) => ({
      stageId: stage.stageId,
      sourceRef: `synthetic-policy:${stage.stageId}`,
      participantSource: {
        type: 'FILTER',
        active: true,
        bidParticipation: 'BIDDABLE',
        ranks: [stage.stageId === 'CAPTAINS' ? 'CPT' : 'FF'],
      },
      ordering: stage.comparator,
    })),
  );
}

function request(ordering = authority()) {
  return BidOrderingAuthorityRequestSchema.parse({
    v: 2,
    sourceDecisionId: sourceDecision.issueId,
    stages: ordering.stages,
  });
}

function decision(ordering = authority()) {
  return BidDefinitionSourceDecisionSchema.parse({
    ...sourceDecision,
    title: 'Synthetic contextual ordering',
    question: 'Which synthetic fact orders each stage?',
    area: 'annual-policy',
    status: 'RESOLVED',
    decision: 'Use the synthetic reviewed stage comparators.',
    sourceRef: 'synthetic-policy:contextual-order',
    resolution: { v: 2, kind: 'CONTEXTUAL_BID_ORDERING', stages: ordering.stages },
  });
}

describe('contextual Bid ordering with synthetic RSC and rank facts', () => {
  it.each([
    { reverse: false, expected: [10002, 10001, 10003, 10004] },
    { reverse: true, expected: [10001, 10002, 10004, 10003] },
  ])(
    'uses different CPT and FF comparators, reverse=$reverse, in compilation and live order',
    ({ reverse, expected }) => {
      const ordering = authority(reverse);
      const resolved = resolveFrozenBidOrderingAuthority({
        request: request(ordering),
        sourceDecisions: [decision(ordering)],
      });
      expect(resolved).toEqual({ ok: true, authority: ordering });
      if (!resolved.ok) throw new Error('Synthetic authority must resolve');
      const evaluation = pinnedEvaluation();
      const compiled = compileStageParticipantsFromPinnedEvaluation({
        pinnedEvaluation: evaluation,
        executionPolicy: policy(),
        stageParticipantSources: sources(ordering),
        orderingAuthority: resolved.authority,
      });
      if (!compiled.ok) throw new Error(JSON.stringify(compiled));
      expect(compiled.executionPolicy.stages.flatMap((stage) => stage.memberIds)).toEqual(expected);
      expect(compiled.provenance.map((entry) => entry.ordering)).toEqual(
        ordering.stages.map((stage) => stage.comparator),
      );
      expect(computeBidEvaluationStageOrder(evaluation, compiled.executionPolicy)).toEqual({
        ok: true,
        entries: expected.map((memberId, index) => ({
          ordinal: index + 1,
          memberId,
          stageId: index < 2 ? 'CAPTAINS' : 'FIREFIGHTERS',
        })),
      });
    },
  );

  it('fails closed when a participant stage source or ordering authority is absent', () => {
    const input = {
      pinnedEvaluation: pinnedEvaluation(),
      executionPolicy: policy(),
      stageParticipantSources: sources(),
    };
    expect(compileStageParticipantsFromPinnedEvaluation(input)).toEqual({
      ok: false,
      code: 'stage_authoring_ordering_authority_unresolved',
    });
    expect(
      compileStageParticipantsFromPinnedEvaluation({
        ...input,
        stageParticipantSources: sources().filter((stage) => stage.stageId === 'CAPTAINS'),
        orderingAuthority: authority(),
      }),
    ).toEqual({
      ok: false,
      code: 'stage_authoring_stage_source_missing',
      stageId: 'FIREFIGHTERS',
    });
  });

  it('never substitutes another stage comparator for a missing contextual comparator', () => {
    const incomplete = {
      ...authority(),
      stages: authority().stages.filter((stage) => stage.stageId === 'CAPTAINS'),
    };
    expect(
      FrozenLiveBidPolicySchema.safeParse({ ...policy(), orderingAuthority: incomplete }).success,
    ).toBe(false);
    expect(
      compileStageParticipantsFromPinnedEvaluation({
        pinnedEvaluation: pinnedEvaluation(),
        executionPolicy: policy(),
        stageParticipantSources: sources(),
        orderingAuthority: incomplete,
      }),
    ).toEqual({
      ok: false,
      code: 'stage_authoring_ordering_authority_mismatch',
      stageId: 'FIREFIGHTERS',
    });
    expect(
      computeBidEvaluationStageOrder(pinnedEvaluation(), {
        ...policy(),
        orderingAuthority: incomplete,
      }),
    ).toEqual({ ok: false, code: 'stage_ordering_authority_mismatch' });
  });

  it('fails closed on a missing required rank fact during compilation and live calculation', () => {
    const evaluation = pinnedEvaluation();
    evaluation.members = evaluation.members.map((member) =>
      member.memberId === 10001 ? { ...member, rankSeniority: null } : member,
    );
    expect(
      compileStageParticipantsFromPinnedEvaluation({
        pinnedEvaluation: evaluation,
        executionPolicy: policy(),
        stageParticipantSources: sources(),
        orderingAuthority: authority(),
      }),
    ).toEqual({
      ok: false,
      code: 'stage_authoring_ordering_fact_missing',
      stageId: 'CAPTAINS',
      memberIds: [10001],
    });
    expect(
      computeBidEvaluationStageOrder(evaluation, { ...policy(), orderingAuthority: authority() }),
    ).toEqual({ ok: false, code: 'stage_ordering_fact_missing' });
  });

  it('rejects missing, unresolved, and contradictory typed source decisions', () => {
    expect(resolveFrozenBidOrderingAuthority({ request: request(), sourceDecisions: [] })).toEqual({
      ok: false,
      code: 'ordering_authority_source_decision_missing',
    });
    expect(
      resolveFrozenBidOrderingAuthority({
        request: request(),
        sourceDecisions: [{ ...decision(), status: 'OPEN' }],
      }),
    ).toEqual({ ok: false, code: 'ordering_authority_source_decision_unresolved' });
    expect(
      resolveFrozenBidOrderingAuthority({
        request: request(),
        sourceDecisions: [decision(authority(true))],
      }),
    ).toEqual({ ok: false, code: 'ordering_authority_comparator_mismatch' });
  });

  it('rejects duplicate contextual stage identities and stage/source comparator disagreement', () => {
    const duplicate = authority();
    duplicate.stages = [...duplicate.stages, { stageId: 'CAPTAINS', comparator: rsc }];
    expect(FrozenBidOrderingAuthoritySchema.safeParse(duplicate).success).toBe(false);
    const inconsistentSources = sources().map((source) =>
      source.stageId === 'CAPTAINS' ? { ...source, ordering: rsc } : source,
    );
    expect(
      compileStageParticipantsFromPinnedEvaluation({
        pinnedEvaluation: pinnedEvaluation(),
        executionPolicy: policy(),
        stageParticipantSources: inconsistentSources,
        orderingAuthority: authority(),
      }),
    ).toEqual({
      ok: false,
      code: 'stage_authoring_ordering_authority_mismatch',
      stageId: 'CAPTAINS',
    });
  });

  it('preserves v1 authority for every stage and legacy unconfigured RSC order', () => {
    const oldAuthority = { v: 1 as const, comparator: rank, sourceDecision };
    expect(FrozenBidOrderingAuthoritySchema.parse(oldAuthority)).toEqual(oldAuthority);
    const oldRequest = BidOrderingAuthorityRequestSchema.parse({
      v: 1,
      sourceDecisionId: sourceDecision.issueId,
      comparator: rank,
    });
    const oldDecision = {
      ...decision(),
      resolution: { v: 1 as const, kind: 'BID_ORDERING_COMPARATOR' as const, comparator: rank },
    };
    expect(
      resolveFrozenBidOrderingAuthority({ request: oldRequest, sourceDecisions: [oldDecision] }),
    ).toEqual({ ok: true, authority: oldAuthority });
    const evaluation = pinnedEvaluation();
    const ordered = computeBidEvaluationStageOrder(evaluation, {
      ...policy(),
      orderingAuthority: oldAuthority,
    });
    if (!ordered.ok) throw new Error(JSON.stringify(ordered));
    expect(ordered.entries.map((entry) => entry.memberId)).toEqual([10002, 10001, 10004, 10003]);
    const legacy = computeBidEvaluationStageOrder(evaluation, policy());
    if (!legacy.ok) throw new Error(JSON.stringify(legacy));
    expect(legacy.entries.map((entry) => entry.memberId)).toEqual([10001, 10002, 10003, 10004]);
  });
});
