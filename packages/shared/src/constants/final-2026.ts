export const FINAL_2026_AS_OF = '2026-09-24' as const;

export const FINAL_2026_TOPOLOGY = {
  total: 228,
  byShift: { A: 74, B: 73, C: 73, D: 8 },
  activeOpportunities: 223,
  nonOpportunityPositionIds: ['A801', 'D201', 'D301', 'D401', 'D402'],
} as const;

export const FINAL_2026_EXCLUDED_EMPLOYEE_IDS = [
  '16584',
  '16613',
  '16617',
  '16573',
  '19131',
  '20734',
] as const;

/** Personnel already marked Exclude by the final MASTER source table before
 * the six later separations were applied. These rows stay in Department
 * history, but they are not members of the ordinary annual Bid cohort. */
export const FINAL_2026_MASTER_EXCLUDED_EMPLOYEE_IDS = [
  '18156',
  '20487',
  '16847',
  '21989',
  '14326',
] as const;

export const FINAL_2026_NON_BIDDER_EMPLOYEE_IDS = [
  ...FINAL_2026_MASTER_EXCLUDED_EMPLOYEE_IDS,
  ...FINAL_2026_EXCLUDED_EMPLOYEE_IDS,
] as const;

export const FINAL_2026_BLOOMFIELD = {
  employeeId: '18158',
  bidRank: 'CPT',
  currentAssignment: 'Acting Division Chief',
} as const;

export const FINAL_2026_ACTIVE_BIDDERS = {
  total: 222,
  byRank: { CPT: 22, LT: 39, FF: 161 },
} as const;

export const FINAL_2026_SWAT_EMPLOYEE_IDS = [
  '18366',
  '16563',
  '20730',
  '19953',
  '24506',
  '20745',
] as const;

export function final2026BidRank<Rank extends string>(
  bidYear: number,
  employeeId: string,
  currentRank: Rank,
): Rank | typeof FINAL_2026_BLOOMFIELD.bidRank {
  return bidYear === 2026 && employeeId === FINAL_2026_BLOOMFIELD.employeeId
    ? FINAL_2026_BLOOMFIELD.bidRank
    : currentRank;
}

export function isFinal2026NonBidder(bidYear: number, employeeId: string): boolean {
  return (
    bidYear === 2026 &&
    (FINAL_2026_NON_BIDDER_EMPLOYEE_IDS as readonly string[]).includes(employeeId)
  );
}
