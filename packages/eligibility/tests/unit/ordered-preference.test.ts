import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../../src/evaluate.js';
import { compare, compareWithTrace } from '../../src/tie-break.js';
import type { Member, PositionRule } from '../../src/types.js';

const rule: PositionRule = {
  positionId: 'synthetic-investigator',
  ruleBookVersion: 'synthetic',
  requiredCriteria: { rank: ['FF'], credentials: ['Minimum'], custom: [] },
  pointsPreference: {
    max: 0,
    items: [],
    scoring: {
      v: 1,
      orderedPreference: {
        mode: 'ORDERED_QUALIFICATIONS',
        sourceRef: 'Synthetic priority source',
        criteria: [
          { credential: 'IAAI', alternatives: ['Reviewed IAAI equivalent'], requiresAll: [] },
        ],
      },
      total: [
        {
          id: 'secondary',
          cap: null,
          excludesAny: ['IAAI', 'Reviewed IAAI equivalent'],
          items: [],
          preference: {
            mode: 'BINARY_CUMULATIVE',
            sourceRef: 'Synthetic cumulative source',
            criteria: ['Course A', 'Course B', 'Course C'].map((credential) => ({
              credential,
              alternatives: [],
              requiresAll: [],
            })),
          },
        },
      ],
      so: [],
      mo: [],
    },
  },
  tieBreakChain: ['points', 'rsc_seniority'],
};
const member = (names: string[], seniority = 1): Member => ({
  employeeId: 'synthetic',
  firstName: '',
  lastName: '',
  rank: 'FF',
  rscSeniority: seniority,
  rankSeniority: seniority,
  isProbationary: false,
  credentials: names.map((name) => ({ name })),
});
const evaluated = (names: string[], seniority = 1, policy = rule) => ({
  ...evaluateEligibility(member(names, seniority), policy),
  rscSeniority: seniority,
  rankSeniority: seniority,
});

describe('explicit ordered qualification preference', () => {
  it('ranks the first qualification before any secondary credits without inventing weighted points', () => {
    const certified = evaluated(['Minimum', 'IAAI'], 99);
    const secondary = evaluated(['Minimum', 'Course A', 'Course B', 'Course C']);
    expect(certified.points).toBe(0);
    expect(secondary.points).toBe(3);
    expect(compare(certified, secondary, rule.tieBreakChain)).toBe(-1);
    expect(compareWithTrace(certified, secondary, rule.tieBreakChain).steps).toEqual([
      {
        key: 'ordered_preference',
        criterion: 'IAAI',
        sourceRef: 'Synthetic priority source',
        left: 1,
        right: 0,
        direction: 'HIGHER_FIRST',
        result: -1,
      },
    ]);
  });
  it('compares cumulative credits then established seniority within the non-IAAI tier', () => {
    const first = evaluated(['Minimum', 'Course A'], 9);
    const second = evaluated(['Minimum'], 1);
    expect(compare(first, second, rule.tieBreakChain)).toBe(-1);
    expect(compare(evaluated(['Minimum'], 9), second, rule.tieBreakChain)).toBe(1);
    expect(compare(second, structuredClone(second), rule.tieBreakChain)).toBe(0);
  });
  it('excludes the secondary credits for IAAI candidates and proceeds to their established seniority', () => {
    const courses = evaluated(['Minimum', 'IAAI', 'Course A', 'Course B', 'Course C'], 9);
    const senior = evaluated(['Minimum', 'IAAI'], 1);
    expect(courses.points).toBe(0);
    expect(compare(courses, senior, rule.tieBreakChain)).toBe(1);
    expect(
      compareWithTrace(courses, senior, rule.tieBreakChain).steps.map((step) => step.key),
    ).toEqual(['ordered_preference', 'points', 'rsc_seniority']);
  });
  it('counts alternatives once and never grants qualification from a preference', () => {
    expect(
      evaluated(['Minimum', 'IAAI', 'Reviewed IAAI equivalent']).orderedPreference?.criteria[0]
        ?.value,
    ).toBe(1);
    expect(evaluated(['IAAI', 'Course A', 'Course B', 'Course C'])).toMatchObject({
      eligible: false,
      points: 0,
    });
  });
  it('does not use expired completion evidence for the ordered qualification', () => {
    const result = evaluateEligibility(
      {
        ...member(['Minimum']),
        scoringEvidence: {
          evaluationOn: '2026-09-19',
          completedCredentialNames: ['IAAI'],
        },
      },
      rule,
    );
    expect(result.orderedPreference?.criteria[0]?.value).toBe(0);
  });
  it('rejects mismatched vector identities or absent evidence instead of falling through to points', () => {
    const left = evaluated(['Minimum', 'IAAI']);
    const right = evaluated(['Minimum']);
    right.orderedPreference = undefined;
    expect(() => compare(left, right, rule.tieBreakChain)).toThrow(
      'ORDERED_PREFERENCE_EVIDENCE_MISMATCH',
    );
    const other = evaluated(['Minimum']);
    if (other.orderedPreference) other.orderedPreference.sourceRef = 'Different authority';
    expect(() => compare(left, other, rule.tieBreakChain)).toThrow(
      'ORDERED_PREFERENCE_EVIDENCE_MISMATCH',
    );
  });
  it('preserves the historical result shape and points ordering when optional policy is absent', () => {
    const legacy = structuredClone(rule);
    if (legacy.pointsPreference.scoring)
      legacy.pointsPreference.scoring.orderedPreference = undefined;
    const first = evaluated(['Minimum', 'IAAI'], 1, legacy);
    const second = evaluated(['Minimum', 'Course A'], 2, legacy);
    expect(first).not.toHaveProperty('orderedPreference');
    expect(compare(first, second, legacy.tieBreakChain)).toBe(1);
  });
});
