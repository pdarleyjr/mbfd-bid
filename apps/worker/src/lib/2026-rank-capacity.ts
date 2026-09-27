import type { BidDefinitionContent } from '@mbfd/shared';

type Rank = 'CPT' | 'LT' | 'FF';
const stageRank: Record<string, Rank> = {
  'days-captains': 'CPT',
  captains: 'CPT',
  'days-lieutenants': 'LT',
  lieutenants: 'LT',
  firefighters: 'FF',
};

/** Rank-specific opportunities are required for every distinct frozen bidder.
 * Days stages can repeat members from their ordinary rank stage. */
export function evaluate2026RankCapacity(
  content: Pick<BidDefinitionContent, 'positions' | 'participation'>,
  stages: readonly { id: string; memberIds: readonly number[] }[],
) {
  const participation = new Map(
    content.participation.map((row) => [row.positionId, row.bidParticipation]),
  );
  const capacity: Record<Rank, number> = { CPT: 0, LT: 0, FF: 0 };
  const bidders: Record<Rank, Set<number>> = { CPT: new Set(), LT: new Set(), FF: new Set() };
  for (const position of content.positions) {
    if (participation.get(position.id) !== 'BIDDABLE') continue;
    if (!(position.rankRequired in capacity))
      throw new Error(`2026_biddable_position_rank_invalid:${position.id}`);
    capacity[position.rankRequired as Rank]++;
  }
  for (const stage of stages) {
    const rank = stageRank[stage.id];
    if (!rank) throw new Error(`2026_rank_capacity_stage_unknown:${stage.id}`);
    for (const memberId of stage.memberIds) {
      if (!Number.isSafeInteger(memberId) || memberId <= 0)
        throw new Error(`2026_rank_capacity_member_invalid:${stage.id}`);
      bidders[rank].add(memberId);
    }
  }
  for (const [rank, ids] of Object.entries(bidders) as [Rank, Set<number>][]) {
    for (const memberId of ids) {
      if (
        Object.entries(bidders).some(
          ([otherRank, others]) => otherRank !== rank && others.has(memberId),
        )
      )
        throw new Error(`2026_rank_capacity_member_multiple_ranks:${memberId}`);
    }
  }
  const counts: Record<Rank, number> = {
    CPT: bidders.CPT.size,
    LT: bidders.LT.size,
    FF: bidders.FF.size,
  };
  return {
    capacity,
    bidders: counts,
    shortages: (Object.keys(capacity) as Rank[])
      .filter((rank) => counts[rank] > capacity[rank])
      .map((rank) => ({ rank, bidders: counts[rank], capacity: capacity[rank] })),
  };
}
