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
