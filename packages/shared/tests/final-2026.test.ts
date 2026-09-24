import { describe, expect, it } from 'vitest';
import {
  FINAL_2026_ACTIVE_BIDDERS,
  FINAL_2026_BLOOMFIELD,
  FINAL_2026_EXCLUDED_EMPLOYEE_IDS,
  FINAL_2026_MASTER_EXCLUDED_EMPLOYEE_IDS,
  FINAL_2026_NON_BIDDER_EMPLOYEE_IDS,
  FINAL_2026_SWAT_EMPLOYEE_IDS,
  FINAL_2026_TOPOLOGY,
  final2026BidRank,
  isFinal2026NonBidder,
} from '../src/index.js';

describe('final 2026 administrative decisions', () => {
  it('publishes the exact topology, cohort and exception identities', () => {
    expect(FINAL_2026_TOPOLOGY).toMatchObject({
      total: 228,
      byShift: { A: 74, B: 73, C: 73, D: 8 },
      activeOpportunities: 223,
      nonOpportunityPositionIds: ['A801', 'D201', 'D301', 'D401', 'D402'],
    });
    expect(FINAL_2026_ACTIVE_BIDDERS).toEqual({
      total: 222,
      byRank: { CPT: 22, LT: 39, FF: 161 },
    });
    expect(FINAL_2026_EXCLUDED_EMPLOYEE_IDS).toHaveLength(6);
    expect(FINAL_2026_MASTER_EXCLUDED_EMPLOYEE_IDS).toEqual([
      '18156',
      '20487',
      '16847',
      '21989',
      '14326',
    ]);
    expect(FINAL_2026_NON_BIDDER_EMPLOYEE_IDS).toHaveLength(11);
    expect(FINAL_2026_SWAT_EMPLOYEE_IDS).toEqual([
      '18366',
      '16563',
      '20730',
      '19953',
      '24506',
      '20745',
    ]);
    expect(FINAL_2026_BLOOMFIELD).toEqual({
      employeeId: '18158',
      bidRank: 'CPT',
      currentAssignment: 'Acting Division Chief',
    });
    expect(final2026BidRank(2026, '18158', 'DC')).toBe('CPT');
    expect(final2026BidRank(2027, '18158', 'DC')).toBe('DC');
    expect(isFinal2026NonBidder(2026, '14326')).toBe(true);
    expect(isFinal2026NonBidder(2026, '16584')).toBe(true);
    expect(isFinal2026NonBidder(2027, '14326')).toBe(false);
  });
});
