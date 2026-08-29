import { describe, expect, it } from 'vitest';
import {
  SPECIALTY_TEST_POLICY_LABEL,
  type SpecialtyTestPolicy,
  type SpecialtyTestPolicyEvaluationInput,
  SpecialtyTestPolicySchema,
  evaluateSpecialtyTestPolicy,
  isSpecialtyTestOutcomeAllowed,
} from '../../src/lib/specialty-test-policy.js';

const syntheticPolicy: SpecialtyTestPolicy = {
  policy_label: SPECIALTY_TEST_POLICY_LABEL,
  policy_version: 'synthetic-specialty-v1',
  specialty_pool: {
    id: 'MARINE_TEST_POOL',
    label: 'Marine Operations synthetic test pool',
  },
  qualification_requirements: {
    v: 1,
    credential_names: ['Marine Operations', 'Driver Operator'],
    specialty_codes: ['SYNTHETIC_MARINE'],
  },
  ranking: {
    source: 'EXPLICIT_TEST_PRIORITY',
    reference: 'synthetic-specialty-ranking-v1',
  },
  scoring: {
    source: 'EXPLICIT_TEST_PRIORITY',
    direction: 'LOWER_SCORE_WINS',
  },
  tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
  normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
  candidate_outcomes: ['award', 'declined', 'unreachable', 'withdrawn', 'ineligible_on_recheck'],
  original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
};

function input(
  overrides: Partial<SpecialtyTestPolicyEvaluationInput> = {},
): SpecialtyTestPolicyEvaluationInput {
  return {
    source: 'synthetic',
    policy: syntheticPolicy,
    frozenCandidates: [
      {
        memberId: 13,
        explicitPriority: 2,
        rscSeniority: 1,
        rankSeniority: 1,
        credentialNames: ['Marine Operations', 'Driver Operator'],
        specialtyQualifications: [
          {
            specialtyCode: 'SYNTHETIC_MARINE',
            status: 'active',
            effectiveOn: '2026-08-01',
            expiresOn: null,
          },
        ],
        generalEligibility: { status: 'eligible' },
      },
      {
        memberId: 22,
        explicitPriority: 1,
        rscSeniority: 1,
        rankSeniority: 5,
        credentialNames: ['Marine Operations', 'Driver Operator'],
        specialtyQualifications: [
          {
            specialtyCode: 'SYNTHETIC_MARINE',
            status: 'active',
            effectiveOn: '2026-08-01',
            expiresOn: null,
          },
        ],
        generalEligibility: { status: 'eligible' },
      },
      {
        memberId: 11,
        explicitPriority: 1,
        rscSeniority: 1,
        rankSeniority: 5,
        credentialNames: ['Marine Operations', 'Driver Operator'],
        specialtyQualifications: [
          {
            specialtyCode: 'SYNTHETIC_MARINE',
            status: 'active',
            effectiveOn: '2026-08-01',
            expiresOn: null,
          },
        ],
        generalEligibility: { status: 'eligible' },
      },
      {
        memberId: 12,
        explicitPriority: 1,
        rscSeniority: 1,
        rankSeniority: 6,
        credentialNames: ['Marine Operations'],
        specialtyQualifications: [
          {
            specialtyCode: 'SYNTHETIC_MARINE',
            status: 'active',
            effectiveOn: '2026-08-01',
            expiresOn: null,
          },
        ],
        generalEligibility: { status: 'eligible' },
      },
      {
        memberId: 14,
        explicitPriority: 1,
        rscSeniority: 2,
        rankSeniority: 1,
        credentialNames: ['Marine Operations', 'Driver Operator'],
        specialtyQualifications: [
          {
            specialtyCode: 'SYNTHETIC_MARINE',
            status: 'expired',
            effectiveOn: '2026-08-01',
            expiresOn: '2026-08-31',
          },
        ],
        generalEligibility: { status: 'ineligible', reasonCodes: ['RANK_NOT_ALLOWED'] },
      },
    ],
    ...overrides,
  };
}

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
    [
      'missing qualification requirements',
      {
        ...syntheticPolicy,
        qualification_requirements: { v: 1, credential_names: [], specialty_codes: [] },
      },
    ],
    [
      'tie-break chain without a terminal member-id resolver',
      { ...syntheticPolicy, tie_break_chain: ['rsc_seniority', 'rank_seniority'] },
    ],
    [
      'unsupported non-engine outcome',
      { ...syntheticPolicy, candidate_outcomes: ['award', 'unavailable'] },
    ],
    ['no award outcome', { ...syntheticPolicy, candidate_outcomes: ['declined', 'unreachable'] }],
    [
      'missing explicit lower-score-first scoring configuration',
      {
        ...syntheticPolicy,
        scoring: { source: 'EXPLICIT_TEST_PRIORITY', direction: 'HIGHER_SCORE_WINS' },
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(SpecialtyTestPolicySchema.safeParse(value).success).toBe(false);
  });

  it('derives frozen specialty eligibility and unique sequential engine ranks without mutating input facts', () => {
    const value = input();
    const before = structuredClone(value);

    const result = evaluateSpecialtyTestPolicy(value);

    expect(result).toMatchObject({
      kind: 'evaluated',
      allowedOutcomes: syntheticPolicy.candidate_outcomes,
      candidates: [
        { memberId: 11, priorityRank: 0, specialtyEligibility: { status: 'eligible' } },
        { memberId: 22, priorityRank: 1, specialtyEligibility: { status: 'eligible' } },
        {
          memberId: 12,
          priorityRank: 2,
          specialtyEligibility: {
            status: 'ineligible',
            reasonCodes: ['SYNTHETIC_SPECIALTY_CREDENTIAL_MISSING:Driver Operator'],
          },
        },
        {
          memberId: 14,
          priorityRank: 3,
          generalEligibility: { status: 'ineligible', reasonCodes: ['RANK_NOT_ALLOWED'] },
          specialtyEligibility: {
            status: 'ineligible',
            reasonCodes: ['SYNTHETIC_SPECIALTY_CODE_NOT_ACTIVE:SYNTHETIC_MARINE'],
          },
        },
        { memberId: 13, priorityRank: 4, specialtyEligibility: { status: 'eligible' } },
      ],
    });
    expect(value).toEqual(before);
  });

  it('fails closed for invalid frozen candidate facts or an ambiguous duplicate member identity', () => {
    const malformedFacts = evaluateSpecialtyTestPolicy({
      ...input(),
      frozenCandidates: [
        {
          ...input().frozenCandidates[0],
          rscSeniority: -1,
        },
      ],
    } as unknown as SpecialtyTestPolicyEvaluationInput);
    expect(malformedFacts).toMatchObject({
      kind: 'rejected',
      code: 'INVALID_FROZEN_CANDIDATE_FACTS',
    });

    const duplicateInput = input();
    const firstCandidate = duplicateInput.frozenCandidates.at(0);
    if (firstCandidate === undefined)
      throw new Error('Synthetic candidate fixture is unexpectedly empty.');
    const duplicateMember = evaluateSpecialtyTestPolicy({
      ...duplicateInput,
      frozenCandidates: [firstCandidate, firstCandidate],
    });
    expect(duplicateMember).toMatchObject({
      kind: 'rejected',
      code: 'DUPLICATE_MEMBER_ID',
    });
  });

  it('allows only the exact engine-compatible outcomes configured by the synthetic test policy', () => {
    const parsed = SpecialtyTestPolicySchema.parse({
      ...syntheticPolicy,
      candidate_outcomes: ['award', 'declined'],
    });

    expect(isSpecialtyTestOutcomeAllowed(parsed, 'award')).toBe(true);
    expect(isSpecialtyTestOutcomeAllowed(parsed, 'declined')).toBe(true);
    expect(isSpecialtyTestOutcomeAllowed(parsed, 'unreachable')).toBe(false);
    expect(isSpecialtyTestOutcomeAllowed(parsed, 'unavailable' as never)).toBe(false);
  });

  it('rejects a legacy untyped qualification list and incomplete frozen specialty facts', () => {
    const legacyPolicy = {
      ...syntheticPolicy,
      qualification_requirements: ['Marine Operations'],
    };
    expect(SpecialtyTestPolicySchema.safeParse(legacyPolicy).success).toBe(true);
    expect(
      evaluateSpecialtyTestPolicy({
        ...input(),
        policy: legacyPolicy,
      } as SpecialtyTestPolicyEvaluationInput),
    ).toMatchObject({
      kind: 'rejected',
      code: 'LEGACY_SYNTHETIC_QUALIFICATION_MODEL_UNSUPPORTED',
    });

    const missingSnapshotFacts = input();
    const firstCandidate = missingSnapshotFacts.frozenCandidates.at(0);
    if (firstCandidate === undefined)
      throw new Error('Synthetic candidate fixture is unexpectedly empty.');
    expect(
      evaluateSpecialtyTestPolicy({
        ...missingSnapshotFacts,
        frozenCandidates: [
          {
            ...firstCandidate,
            specialtyQualifications: undefined,
          },
        ],
      } as unknown as SpecialtyTestPolicyEvaluationInput),
    ).toMatchObject({ kind: 'rejected', code: 'INVALID_FROZEN_CANDIDATE_FACTS' });
  });
});
