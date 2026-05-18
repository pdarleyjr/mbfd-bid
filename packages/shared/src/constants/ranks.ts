export const RANKS = ['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'] as const;
export type Rank = (typeof RANKS)[number];

export const RANK_LABELS: Record<Rank, string> = {
  FF: 'Firefighter',
  LT: 'Lieutenant',
  CPT: 'Captain',
  DC: 'Division Chief',
  DEP_CHIEF: 'Deputy Chief',
  CHIEF: 'Fire Chief',
};

/** Ranks that actively participate in the annual bid (excludes Deputy Chief / Chief). */
export const BIDDING_RANKS = ['FF', 'LT', 'CPT', 'DC'] as const satisfies readonly Rank[];
export type BiddingRank = (typeof BIDDING_RANKS)[number];
