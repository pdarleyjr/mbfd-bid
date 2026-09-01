import type { BidSessionPolicySnapshot, FrozenLiveBidPolicy } from '@mbfd/shared';

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
        | 'stage_seniority_tie';
    };

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
    // A frozen live order must never invent a tiebreak from a member id. A
    // duplicate supposedly-unique seniority fact is source/policy integrity
    // failure and requires explicit command-staff correction.
    const seniorityKeys = new Set<string>();
    for (const member of stageMembers) {
      const key = `${member.rscSeniority}:${member.rankSeniority ?? 'none'}`;
      if (seniorityKeys.has(key)) return { ok: false, code: 'stage_seniority_tie' };
      seniorityKeys.add(key);
    }
    stageMembers.sort((left, right) => {
      if (left.rscSeniority !== right.rscSeniority) return left.rscSeniority - right.rscSeniority;
      const leftRank = left.rankSeniority ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rankSeniority ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return 0;
    });
    for (const member of stageMembers) {
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
