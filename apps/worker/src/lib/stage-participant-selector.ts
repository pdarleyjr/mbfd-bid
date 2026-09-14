import {
  type BidEvaluation,
  type FrozenBidOrderingAuthority,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  type FrozenStageParticipantProvenance,
  type StageParticipantOrdering,
  type StageParticipantSourceDefinition,
  type StageParticipantSourceDefinitions,
} from '@mbfd/shared';

type PinnedMember = BidEvaluation['members'][number];

export type StageParticipantCompilationFailureCode =
  | 'stage_authoring_unknown_stage'
  | 'stage_authoring_stage_source_missing'
  | 'stage_authoring_member_not_in_pinned_evaluation'
  | 'stage_authoring_member_not_participant'
  | 'stage_authoring_empty_resolution'
  | 'stage_authoring_member_in_multiple_stages'
  | 'stage_authoring_population_incomplete'
  | 'stage_authoring_ordering_fact_missing'
  | 'stage_authoring_ordering_tie'
  | 'stage_authoring_ordering_authority_unresolved'
  | 'stage_authoring_ordering_authority_mismatch'
  | 'stage_authoring_compilation_invalid';

/**
 * Resolved membership is deliberately not an execution artifact. Its member
 * sequence is a deterministic display order for review only; run preparation
 * must separately establish an authoritative comparator before freezing order.
 */
export type ResolvedStageParticipantMembership = {
  stageId: string;
  definition: StageParticipantSourceDefinition;
  matchedMembers: readonly BidEvaluation['members'][number][];
  matchedMemberIds: readonly number[];
  displayOrder: 'MEMBER_ID_ASC';
};

export type StageParticipantMembershipResolution =
  | {
      ok: true;
      kind: 'legacy_explicit_members' | 'resolved_typed_sources';
      capturedAtMs: number;
      stages: readonly ResolvedStageParticipantMembership[];
    }
  | {
      ok: false;
      code: StageParticipantCompilationFailureCode;
      stageId?: string;
      memberIds?: readonly number[];
    };

export type StageParticipantCompilation =
  | {
      ok: true;
      /** A legacy definition has no typed sources, so its explicit policy stays untouched. */
      kind: 'legacy_explicit_members' | 'resolved_typed_sources';
      executionPolicy: FrozenLiveBidPolicy;
      provenance: readonly FrozenStageParticipantProvenance[];
    }
  | {
      ok: false;
      code: StageParticipantCompilationFailureCode;
      stageId?: string;
      memberIds?: readonly number[];
    };

function isPinnedBidParticipant(member: PinnedMember): boolean {
  // `prepareCapturedBidEvaluation` has already made active status and member
  // participation an immutable pool fact. A selector only reads that captured
  // fact; it must not reopen personnel or staffing tables.
  return member.pool !== 'EXCLUDED';
}

function comparisonValue(member: PinnedMember, key: StageParticipantOrdering[number]['key']) {
  return key === 'RSC_SENIORITY' ? member.rscSeniority : member.rankSeniority;
}

function sortByAuthoredOrdering(input: {
  stageId: string;
  members: readonly PinnedMember[];
  ordering: StageParticipantOrdering;
}):
  | { ok: true; members: PinnedMember[] }
  | {
      ok: false;
      code: 'stage_authoring_ordering_fact_missing' | 'stage_authoring_ordering_tie';
      stageId: string;
      memberIds?: readonly number[];
    } {
  for (const member of input.members) {
    for (const rule of input.ordering) {
      if (comparisonValue(member, rule.key) === null)
        return {
          ok: false,
          code: 'stage_authoring_ordering_fact_missing',
          stageId: input.stageId,
          memberIds: [member.memberId],
        };
    }
  }
  const compare = (left: PinnedMember, right: PinnedMember) => {
    for (const rule of input.ordering) {
      const leftValue = comparisonValue(left, rule.key);
      const rightValue = comparisonValue(right, rule.key);
      // Missing rank seniority is rejected above for every ordering term.
      if (leftValue === null || rightValue === null) return 0;
      if (leftValue === rightValue) continue;
      const ascending = leftValue < rightValue ? -1 : 1;
      return rule.direction === 'ASC' ? ascending : -ascending;
    }
    return 0;
  };
  const members = [...input.members].sort(compare);
  for (let index = 1; index < members.length; index += 1) {
    const prior = members[index - 1];
    const current = members[index];
    if (prior !== undefined && current !== undefined && compare(prior, current) === 0)
      return {
        ok: false,
        code: 'stage_authoring_ordering_tie',
        stageId: input.stageId,
        memberIds: [prior.memberId, current.memberId],
      };
  }
  return { ok: true, members };
}

function sameOrdering(left: StageParticipantOrdering, right: StageParticipantOrdering): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function selectPinnedMembers(input: {
  definition: StageParticipantSourceDefinition;
  membersById: ReadonlyMap<number, PinnedMember>;
  pinnedMembers: readonly PinnedMember[];
}):
  | { ok: true; members: PinnedMember[] }
  | {
      ok: false;
      code:
        | 'stage_authoring_member_not_in_pinned_evaluation'
        | 'stage_authoring_member_not_participant'
        | 'stage_authoring_empty_resolution';
      stageId: string;
      memberIds?: readonly number[];
    } {
  const { definition } = input;
  const participantSource = definition.participantSource;
  if (participantSource.type === 'EXPLICIT_MEMBERS') {
    const members: PinnedMember[] = [];
    for (const memberId of participantSource.memberIds) {
      const member = input.membersById.get(memberId);
      if (member === undefined)
        return {
          ok: false,
          code: 'stage_authoring_member_not_in_pinned_evaluation',
          stageId: definition.stageId,
          memberIds: [memberId],
        };
      if (!isPinnedBidParticipant(member))
        return {
          ok: false,
          code: 'stage_authoring_member_not_participant',
          stageId: definition.stageId,
          memberIds: [memberId],
        };
      members.push(member);
    }
    return { ok: true, members };
  }
  const ranks = participantSource.ranks;
  const selectedRanks = new Set<string>(ranks);
  const members = input.pinnedMembers.filter(
    (member) => isPinnedBidParticipant(member) && selectedRanks.has(member.rank),
  );
  if (members.length === 0)
    return { ok: false, code: 'stage_authoring_empty_resolution', stageId: definition.stageId };
  return { ok: true, members };
}

/**
 * Resolves saved typed stage membership against a caller-supplied, already
 * pinned Department evaluation. This pure operation never sorts a Bid order,
 * queries a current roster, or creates a frozen execution artifact.
 */
export function resolveStageParticipantMembership(input: {
  pinnedEvaluation: Pick<BidEvaluation, 'capturedAtMs' | 'members'>;
  executionPolicy: FrozenLiveBidPolicy;
  stageParticipantSources: StageParticipantSourceDefinitions | undefined;
}): StageParticipantMembershipResolution {
  if (input.stageParticipantSources === undefined)
    return {
      ok: true,
      kind: 'legacy_explicit_members',
      capturedAtMs: input.pinnedEvaluation.capturedAtMs,
      stages: [],
    };

  const definitionsByStageId = new Map(
    input.stageParticipantSources.map((definition) => [definition.stageId, definition]),
  );
  const stageIds = new Set(input.executionPolicy.stages.map((stage) => stage.id));
  for (const definition of input.stageParticipantSources) {
    if (!stageIds.has(definition.stageId))
      return { ok: false, code: 'stage_authoring_unknown_stage', stageId: definition.stageId };
  }
  for (const stage of input.executionPolicy.stages) {
    if (!definitionsByStageId.has(stage.id))
      return { ok: false, code: 'stage_authoring_stage_source_missing', stageId: stage.id };
  }

  const membersById = new Map(
    input.pinnedEvaluation.members.map((member) => [member.memberId, member]),
  );
  const includedMemberIds = new Set<number>();
  const stages: ResolvedStageParticipantMembership[] = [];
  for (const stage of input.executionPolicy.stages) {
    const definition = definitionsByStageId.get(stage.id);
    if (definition === undefined)
      return { ok: false, code: 'stage_authoring_stage_source_missing', stageId: stage.id };
    const selected = selectPinnedMembers({
      definition,
      membersById,
      pinnedMembers: input.pinnedEvaluation.members,
    });
    if (!selected.ok) return selected;
    const members = [...selected.members].sort((left, right) => left.memberId - right.memberId);
    const memberIds = members.map((member) => member.memberId);
    const duplicate = memberIds.find((memberId) => includedMemberIds.has(memberId));
    if (duplicate !== undefined)
      return {
        ok: false,
        code: 'stage_authoring_member_in_multiple_stages',
        stageId: stage.id,
        memberIds: [duplicate],
      };
    for (const memberId of memberIds) includedMemberIds.add(memberId);
    stages.push({
      stageId: stage.id,
      definition,
      matchedMembers: members,
      matchedMemberIds: memberIds,
      displayOrder: 'MEMBER_ID_ASC',
    });
  }
  const uncoveredMemberIds = input.pinnedEvaluation.members
    .filter((member) => isPinnedBidParticipant(member) && !includedMemberIds.has(member.memberId))
    .map((member) => member.memberId);
  if (uncoveredMemberIds.length > 0)
    return {
      ok: false,
      code: 'stage_authoring_population_incomplete',
      memberIds: uncoveredMemberIds,
    };
  return {
    ok: true,
    kind: 'resolved_typed_sources',
    capturedAtMs: input.pinnedEvaluation.capturedAtMs,
    stages,
  };
}

/**
 * Converts a successful membership resolution into the explicit ordered
 * execution shape only when an independently resolved annual-policy
 * comparator is supplied. It never derives authority from historical RSC/rank
 * behavior for newly authored typed selectors.
 */
export function compileFrozenStageParticipants(input: {
  membership: Extract<StageParticipantMembershipResolution, { ok: true }>;
  executionPolicy: FrozenLiveBidPolicy;
  /** Supplied only after an exact RESOLVED annual-policy source decision. */
  orderingAuthority?: FrozenBidOrderingAuthority;
}): StageParticipantCompilation {
  if (input.membership.kind === 'legacy_explicit_members')
    return {
      ok: true,
      kind: 'legacy_explicit_members',
      executionPolicy: FrozenLiveBidPolicySchema.parse(input.executionPolicy),
      provenance: [],
    };
  if (input.orderingAuthority === undefined)
    return { ok: false, code: 'stage_authoring_ordering_authority_unresolved' };

  const membershipByStageId = new Map(
    input.membership.stages.map((stage) => [stage.stageId, stage]),
  );
  const stages: FrozenLiveBidPolicy['stages'] = [];
  const provenance: FrozenStageParticipantProvenance[] = [];
  for (const stage of input.executionPolicy.stages) {
    const membership = membershipByStageId.get(stage.id);
    if (membership === undefined)
      return { ok: false, code: 'stage_authoring_stage_source_missing', stageId: stage.id };
    if (!sameOrdering(membership.definition.ordering, input.orderingAuthority.comparator))
      return {
        ok: false,
        code: 'stage_authoring_ordering_authority_mismatch',
        stageId: stage.id,
      };
    const ordered = sortByAuthoredOrdering({
      stageId: stage.id,
      members: membership.matchedMembers,
      ordering: input.orderingAuthority.comparator,
    });
    if (!ordered.ok) return ordered;
    const memberIds = ordered.members.map((member) => member.memberId);
    const participantProvenance: FrozenStageParticipantProvenance = {
      v: 1,
      stageId: stage.id,
      sourceRef: membership.definition.sourceRef,
      participantSource: membership.definition.participantSource,
      ordering: membership.definition.ordering,
      orderingAuthority: input.orderingAuthority,
      pinnedEvaluationCapturedAtMs: input.membership.capturedAtMs,
      resolvedMemberIds: memberIds,
    };
    provenance.push(participantProvenance);
    stages.push({ ...stage, memberIds, participantProvenance });
  }
  const { orderingAuthority: _unverifiedAuthority, ...withoutAuthority } = input.executionPolicy;
  const parsed = FrozenLiveBidPolicySchema.safeParse({
    ...withoutAuthority,
    orderingAuthority: input.orderingAuthority,
    stages,
  });
  if (!parsed.success) return { ok: false, code: 'stage_authoring_compilation_invalid' };
  return {
    ok: true,
    kind: 'resolved_typed_sources',
    executionPolicy: parsed.data,
    provenance,
  };
}

/**
 * Compatibility wrapper for existing run-preparation callers. Typed sources
 * now resolve membership first and fail closed until an authoritative
 * comparator is independently supplied; legacy explicit policies are retained
 * exactly as they were.
 */
export function compileStageParticipantsFromPinnedEvaluation(input: {
  pinnedEvaluation: Pick<BidEvaluation, 'capturedAtMs' | 'members'>;
  executionPolicy: FrozenLiveBidPolicy;
  stageParticipantSources: StageParticipantSourceDefinitions | undefined;
  orderingAuthority?: FrozenBidOrderingAuthority;
}): StageParticipantCompilation {
  const membership = resolveStageParticipantMembership(input);
  if (!membership.ok) return membership;
  return compileFrozenStageParticipants({
    membership,
    executionPolicy: input.executionPolicy,
    ...(input.orderingAuthority === undefined
      ? {}
      : { orderingAuthority: input.orderingAuthority }),
  });
}
