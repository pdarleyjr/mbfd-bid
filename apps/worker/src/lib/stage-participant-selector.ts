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
  | 'stage_authoring_ordering_authority_mismatch'
  | 'stage_authoring_compilation_invalid';

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

/** Preserve the historical execution ordering whenever a typed selector has
 * not been bound to an independently resolved governing comparator. */
function sortWithLegacySeniority(input: {
  stageId: string;
  members: readonly PinnedMember[];
}):
  | { ok: true; members: PinnedMember[] }
  | {
      ok: false;
      code: 'stage_authoring_ordering_tie';
      stageId: string;
      memberIds: readonly number[];
    } {
  const keys = new Set<string>();
  for (const member of input.members) {
    const key = `${member.rscSeniority}:${member.rankSeniority ?? 'none'}`;
    if (keys.has(key))
      return {
        ok: false,
        code: 'stage_authoring_ordering_tie',
        stageId: input.stageId,
        memberIds: [member.memberId],
      };
    keys.add(key);
  }
  return {
    ok: true,
    members: [...input.members].sort((left, right) => {
      if (left.rscSeniority !== right.rscSeniority) return left.rscSeniority - right.rscSeniority;
      const leftRank = left.rankSeniority ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rankSeniority ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    }),
  };
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
 * Compiles saved stage authoring against a caller-supplied, already pinned
 * Department evaluation. This is deliberately a pure function: no DB handle,
 * current-roster adapter, or wall-clock lookup can enter the execution path.
 * Its output remains the existing explicit FrozenLiveBidPolicy shape.
 */
export function compileStageParticipantsFromPinnedEvaluation(input: {
  pinnedEvaluation: Pick<BidEvaluation, 'capturedAtMs' | 'members'>;
  executionPolicy: FrozenLiveBidPolicy;
  stageParticipantSources: StageParticipantSourceDefinitions | undefined;
  /** Supplied only by the saved-definition compiler after it resolves an exact
   * RESOLVED annual-policy source decision. */
  orderingAuthority?: FrozenBidOrderingAuthority;
}): StageParticipantCompilation {
  if (input.stageParticipantSources === undefined)
    return {
      ok: true,
      kind: 'legacy_explicit_members',
      executionPolicy: FrozenLiveBidPolicySchema.parse(input.executionPolicy),
      provenance: [],
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
  const provenance: FrozenStageParticipantProvenance[] = [];
  const stages = [] as FrozenLiveBidPolicy['stages'];
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
    if (
      input.orderingAuthority !== undefined &&
      !sameOrdering(definition.ordering, input.orderingAuthority.comparator)
    )
      return {
        ok: false,
        code: 'stage_authoring_ordering_authority_mismatch',
        stageId: stage.id,
      };
    const ordered =
      input.orderingAuthority === undefined
        ? sortWithLegacySeniority({ stageId: stage.id, members: selected.members })
        : sortByAuthoredOrdering({
            stageId: stage.id,
            members: selected.members,
            ordering: definition.ordering,
          });
    if (!ordered.ok) return ordered;
    const memberIds = ordered.members.map((member) => member.memberId);
    const duplicate = memberIds.find((memberId) => includedMemberIds.has(memberId));
    if (duplicate !== undefined)
      return {
        ok: false,
        code: 'stage_authoring_member_in_multiple_stages',
        stageId: stage.id,
        memberIds: [duplicate],
      };
    for (const memberId of memberIds) includedMemberIds.add(memberId);
    const participantProvenance: FrozenStageParticipantProvenance = {
      v: 1,
      stageId: stage.id,
      sourceRef: definition.sourceRef,
      participantSource: definition.participantSource,
      ordering: definition.ordering,
      ...(input.orderingAuthority === undefined
        ? {}
        : { orderingAuthority: input.orderingAuthority }),
      pinnedEvaluationCapturedAtMs: input.pinnedEvaluation.capturedAtMs,
      resolvedMemberIds: memberIds,
    };
    provenance.push(participantProvenance);
    stages.push({ ...stage, memberIds, participantProvenance });
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
  const parsed = FrozenLiveBidPolicySchema.safeParse({
    ...input.executionPolicy,
    ...(input.orderingAuthority === undefined
      ? {}
      : { orderingAuthority: input.orderingAuthority }),
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
