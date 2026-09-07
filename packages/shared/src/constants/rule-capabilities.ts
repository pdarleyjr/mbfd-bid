/** Bounded engine capabilities. These describe supported algorithms, not annual policy. */
export const RULE_RANKS = ['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF'] as const;
export const ANNUAL_POSITION_RANKS = ['FF', 'LT', 'CPT', 'DC'] as const;
export const RULE_CUSTOM_CRITERIA = ['paramedic', 'driver_engineer', 'non_probationary'] as const;
export const RULE_OPS_GATES = ['paired_operation', 'all_operations'] as const;
export const RULE_TIE_BREAK_KEYS = [
  'points',
  'so_points',
  'mo_points',
  'rsc_seniority',
  'rank_seniority',
] as const;
