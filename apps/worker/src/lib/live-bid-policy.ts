import type {
  BidEvaluation,
  BidSessionPolicySnapshot,
  FrozenLiveBidPolicy,
  StageParticipantOrdering,
} from '@mbfd/shared';
import { bidOrderingComparatorForStage, bidOrdinalValue } from '@mbfd/shared';

export interface FrozenStageOrderEntry {
  ordinal: number;
  memberId: number;
  stageId: string;
}

export type FrozenStageOrderResult =
  | { ok: true; entries: readonly FrozenStageOrderEntry[] }
  | {
      ok: false;
      code:
        | 'live_policy_missing'
        | 'stage_member_not_in_snapshot'
        | 'stage_member_excluded'
        | 'stage_coverage_incomplete'
        | 'stage_seniority_tie'
        | 'stage_ordering_fact_missing'
        | 'stage_ordering_tie'
        | 'stage_ordering_authority_unresolved'
        | 'stage_ordering_authority_mismatch';
    };

type StageMember = BidEvaluation['members'][number];

function orderingValue(member: StageMember, key: StageParticipantOrdering[number]['key']) {
  return bidOrdinalValue(member, key);
}

export function sortWithFrozenOrdering(
  stageMembers: readonly StageMember[],
  ordering: StageParticipantOrdering,
):
  | { ok: true; members: StageMember[] }
  | { ok: false; code: 'stage_ordering_fact_missing' | 'stage_ordering_tie' } {
  for (const member of stageMembers) {
    for (const rule of ordering) {
      if (orderingValue(member, rule.key) === null)
        return { ok: false, code: 'stage_ordering_fact_missing' };
    }
  }
  const compare = (left: StageMember, right: StageMember) => {
    for (const rule of ordering) {
      const leftValue = orderingValue(left, rule.key);
      const rightValue = orderingValue(right, rule.key);
      // A missing value was rejected above for every configured key.
      if (leftValue === null || rightValue === null) return 0;
      if (leftValue === rightValue) continue;
      const ascending = leftValue < rightValue ? -1 : 1;
      return rule.direction === 'ASC' ? ascending : -ascending;
    }
    return 0;
  };
  const members = [...stageMembers].sort(compare);
  for (let index = 1; index < members.length; index += 1) {
    const prior = members[index - 1];
    const current = members[index];
    if (prior !== undefined && current !== undefined && compare(prior, current) === 0)
      return { ok: false, code: 'stage_ordering_tie' };
  }
  return { ok: true, members };
}

/** Existing frozen policies have no authored selector metadata. Preserve their
 * fixed RSC → rank ordering and its original tie semantics exactly. */
function sortWithLegacySeniority(
  stageMembers: readonly StageMember[],
): { ok: true; members: StageMember[] } | { ok: false; code: 'stage_seniority_tie' } {
  const seniorityKeys = new Set<string>();
  for (const member of stageMembers) {
    const key = `${member.rscSeniority}:${member.rankSeniority ?? 'none'}`;
    if (seniorityKeys.has(key)) return { ok: false, code: 'stage_seniority_tie' };
    seniorityKeys.add(key);
  }
  const members = [...stageMembers].sort((left, right) => {
    if (left.rscSeniority !== right.rscSeniority) return left.rscSeniority - right.rscSeniority;
    const leftRank = left.rankSeniority ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.rankSeniority ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return 0;
  });
  return { ok: true, members };
}

function sameOrdering(left: StageParticipantOrdering, right: StageParticipantOrdering): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function orderingForStage(input: {
  policy: FrozenLiveBidPolicy;
  stage: FrozenLiveBidPolicy['stages'][number];
}):
  | { ok: true; ordering: StageParticipantOrdering | null }
  | {
      ok: false;
      code: 'stage_ordering_authority_unresolved' | 'stage_ordering_authority_mismatch';
    } {
  const policyAuthority = input.policy.orderingAuthority;
  const comparator = bidOrderingComparatorForStage(policyAuthority, input.stage.id);
  if (policyAuthority !== undefined && comparator === undefined)
    return { ok: false, code: 'stage_ordering_authority_mismatch' };
  const provenance = input.stage.participantProvenance;
  if (provenance !== undefined && provenance.orderingAuthority === undefined)
    return { ok: false, code: 'stage_ordering_authority_unresolved' };
  if (provenance !== undefined && provenance.orderingAuthority !== undefined) {
    const provenanceAuthority = provenance.orderingAuthority;
    if (
      policyAuthority === undefined ||
      JSON.stringify(provenanceAuthority) !== JSON.stringify(policyAuthority) ||
      comparator === undefined ||
      !sameOrdering(provenance.ordering, comparator)
    )
      return { ok: false, code: 'stage_ordering_authority_mismatch' };
    return { ok: true, ordering: provenance.ordering };
  }
  // A verified policy-level authority governs legacy explicit stages too.
  // Only stages without typed provenance may retain historical RSC→rank order.
  return { ok: true, ordering: comparator ?? null };
}

/**
 * Creates the live order from an already frozen annual policy, never today’s
 * roster. Each stage has an explicit order and membership; seniority is only
 * the stable ordering *within* that stage.
 */
export function computeFrozenStageOrder(
  snapshot: BidSessionPolicySnapshot,
  livePolicy: FrozenLiveBidPolicy | null | undefined,
): FrozenStageOrderResult {
  if (snapshot.v !== 3 || livePolicy === null || livePolicy === undefined) {
    return { ok: false, code: 'live_policy_missing' };
  }
  return computeBidEvaluationStageOrder(snapshot, livePolicy);
}

/** Same stage authority for an unsaved calculation; no session is invented. */
export function computeBidEvaluationStageOrder(
  snapshot: Pick<BidEvaluation, 'members'>,
  livePolicy: FrozenLiveBidPolicy,
): FrozenStageOrderResult {
  const members = new Map(snapshot.members.map((member) => [member.memberId, member]));
  const included = new Set<number>();
  const entries: FrozenStageOrderEntry[] = [];
  for (const stage of [...livePolicy.stages].sort((left, right) => left.order - right.order)) {
    const stageMembers = [] as typeof snapshot.members;
    for (const memberId of stage.memberIds) {
      const member = members.get(memberId);
      if (member === undefined) return { ok: false, code: 'stage_member_not_in_snapshot' };
      if (member.pool === 'EXCLUDED') return { ok: false, code: 'stage_member_excluded' };
      included.add(memberId);
      stageMembers.push(member);
    }
    const configuredOrdering = orderingForStage({ policy: livePolicy, stage });
    if (!configuredOrdering.ok) return configuredOrdering;
    const ordered =
      configuredOrdering.ordering === null
        ? sortWithLegacySeniority(stageMembers)
        : sortWithFrozenOrdering(stageMembers, configuredOrdering.ordering);
    if (!ordered.ok) return ordered;
    for (const member of ordered.members) {
      entries.push({ ordinal: entries.length + 1, memberId: member.memberId, stageId: stage.id });
    }
  }
  if (
    snapshot.members.some((member) => member.pool !== 'EXCLUDED' && !included.has(member.memberId))
  ) {
    return { ok: false, code: 'stage_coverage_incomplete' };
  }
  return { ok: true, entries };
}

/** A reserved/non-stage position is never inferred as a live opportunity. */
export function isPositionAllowedForCurrentStage(
  policy: FrozenLiveBidPolicy | null | undefined,
  stageId: string | null,
  positionId: string,
): boolean {
  if (policy === null || policy === undefined || stageId === null) return false;
  return policy.stages.some(
    (stage) => stage.id === stageId && stage.opportunityPositionIds.includes(positionId),
  );
}
