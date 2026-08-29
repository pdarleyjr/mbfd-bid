import { describe, expect, it } from 'vitest';
import { SpecialtyTestPolicySchema } from '../../src/lib/specialty-test-policy.js';

const syntheticPolicy = {
  policy_label: 'TEST POLICY — NOT APPROVED MBFD POLICY',
  policy_version: 'synthetic-specialty-v1',
  specialty_pool: {
    id: 'MARINE_TEST_POOL',
    label: 'Marine Operations synthetic test pool',
  },
  qualification_requirements: ['Marine Operations', 'Driver Operator'],
  ranking: {
    source: 'EXPLICIT_TEST_PRIORITY',
    reference: 'synthetic-specialty-ranking-v1',
  },
  tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
  normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
  candidate_outcomes: ['award', 'declined', 'unavailable'],
  original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
};

describe('synthetic specialty test policy envelope', () => {
  it('accepts a complete, labelled, versioned synthetic policy', () => {
    expect(SpecialtyTestPolicySchema.parse(syntheticPolicy)).toEqual(syntheticPolicy);
  });

  it.each([
    [
      'missing explicit test-policy label',
      { ...syntheticPolicy, policy_label: 'MBFD Marine Policy' },
    ],
    ['empty policy version', { ...syntheticPolicy, policy_version: ' ' }],
    ['missing qualification requirements', { ...syntheticPolicy, qualification_requirements: [] }],
    ['ambiguous tie-break chain', { ...syntheticPolicy, tie_break_chain: ['rsc_seniority'] }],
    ['no unavailable outcome', { ...syntheticPolicy, candidate_outcomes: ['award', 'declined'] }],
  ])('rejects %s', (_label, value) => {
    expect(SpecialtyTestPolicySchema.safeParse(value).success).toBe(false);
  });
});
