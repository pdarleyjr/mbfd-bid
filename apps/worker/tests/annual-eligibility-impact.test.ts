import type { PositionRule } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import {
  type ImpactMember,
  annualEligibilityImpact,
} from '../src/lib/annual-eligibility-impact.js';
const member = (
  memberId: number,
  credentials: string[] = [],
  seniority = memberId,
): ImpactMember => ({
  memberId,
  evidence: {
    employeeId: `synthetic-${memberId}`,
    firstName: 'Synthetic',
    lastName: `Member ${memberId}`,
    rank: 'FF',
    rscSeniority: seniority,
    rankSeniority: seniority,
    isProbationary: false,
    credentials: credentials.map((name) => ({ name })),
  },
});
const rule: PositionRule = {
  positionId: 'stable-seat',
  ruleBookVersion: 'synthetic',
  requiredCriteria: { rank: ['FF'], credentials: [], custom: [] },
  pointsPreference: {
    max: 10,
    items: [{ credential: 'Synthetic credential', points: 2, requiresOpsPair: false }],
  },
  tieBreakChain: ['points', 'rank_seniority'],
};
describe('controlled annual eligibility comparisons', () => {
  it('separates qualification and cohort changes from policy-only effects', () => {
    const result = annualEligibilityImpact({
      beforeMembers: [member(1), member(2, ['Synthetic credential']), member(3)],
      afterMembers: [
        member(1, ['Synthetic credential']),
        member(2, ['Synthetic credential']),
        member(4),
      ],
      beforeRules: [rule, { ...rule, positionId: 'removed' }],
      afterRules: [
        {
          ...rule,
          requiredCriteria: { ...rule.requiredCriteria, credentials: ['Synthetic credential'] },
        },
        { ...rule, positionId: 'new' },
      ],
    });
    expect(result.evaluatedComparisons).toBe(3);
    expect(result.changed).toMatchObject([
      { memberId: 4, before: { eligible: true }, after: { eligible: false, priority: null } },
    ]);
    expect(result.evidence.evaluatedComparisons).toBe(2);
    expect(result.evidence.changed).toMatchObject([
      { memberId: 1, before: { points: 0, priority: 2 }, after: { points: 2, priority: 1 } },
      { memberId: 2, before: { points: 2, priority: 1 }, after: { points: 2, priority: 2 } },
    ]);
    expect(result.incomparable).toEqual({
      addedMemberIds: [4],
      removedMemberIds: [3],
      addedPositionIds: ['new'],
      removedPositionIds: ['removed'],
    });
  });
  it('shows changed priority for unchanged scores and preserves unresolved ties', () => {
    const members = [member(1, ['Synthetic credential'], 2), member(2, [], 1), member(3, [], 1)];
    const result = annualEligibilityImpact({
      beforeMembers: members,
      afterMembers: members,
      beforeRules: [rule],
      afterRules: [{ ...rule, tieBreakChain: ['rank_seniority'] }],
    });
    expect(result.changed).toMatchObject([
      { memberId: 1, before: { points: 2, priority: 1 }, after: { points: 2, priority: 3 } },
      { memberId: 2, before: { priority: 2 }, after: { priority: 1 } },
      { memberId: 3, before: { priority: 2 }, after: { priority: 1 } },
    ]);
    expect(result.evidence.changed).toEqual([]);
  });
  it('fails ambiguous identities instead of silently overwriting members', () => {
    expect(() =>
      annualEligibilityImpact({
        beforeMembers: [member(1), member(1)],
        afterMembers: [],
        beforeRules: [],
        afterRules: [],
      }),
    ).toThrow('Ambiguous impact member');
  });
});
