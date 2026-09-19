import { describe, expect, it } from 'vitest';
import { evaluateEligibilityWithTrace } from '../src/evaluate.js';
import type { Member, PositionRule } from '../src/types.js';

const base: Member = {
  employeeId: 'synthetic-preference',
  firstName: '',
  lastName: '',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary: false,
  credentials: [],
};
const rule: PositionRule = {
  positionId: 'synthetic-seat',
  ruleBookVersion: 'synthetic-policy',
  requiredCriteria: { rank: ['FF'], credentials: ['Minimum'], custom: [] },
  pointsPreference: {
    max: 0,
    items: [],
    scoring: {
      v: 1,
      total: [
        {
          id: 'numeric',
          cap: null,
          items: [{ credential: 'Numeric', alternatives: [], requiresAll: [], points: 7 }],
        },
        {
          id: 'binary',
          cap: null,
          items: [],
          preference: {
            mode: 'BINARY_CUMULATIVE',
            sourceRef: 'Synthetic cumulative source',
            criteria: [
              {
                credential: 'Course I',
                alternatives: ['Reviewed equivalent I'],
                requiresAll: ['Course II'],
              },
              { credential: 'Independent course', alternatives: [], requiresAll: [] },
            ],
          },
        },
      ],
      so: [],
      mo: [],
    },
  },
  tieBreakChain: ['points'],
};
const member = (...names: string[]): Member => ({
  ...base,
  credentials: names.map((name) => ({ name })),
});

describe('cumulative preference evaluation', () => {
  it.each([
    [[], 0],
    [['Course I'], 0],
    [['Course II'], 0],
    [['Course I', 'Course II'], 1],
    [['Reviewed equivalent I', 'Course II'], 1],
    [['Course I', 'Reviewed equivalent I', 'Course II', 'Independent course'], 2],
  ] as [string[], number][])(
    'counts satisfied criteria without weighting or duplicate aliases %j',
    (names, credits) => {
      const { result, channels } = evaluateEligibilityWithTrace(
        member('Minimum', 'Numeric', ...names),
        rule,
      );
      expect(result).toMatchObject({ eligible: true, points: 7 + credits });
      expect(channels.total.itemized[1]?.reason).toContain(
        'Binary cumulative preference credit; Synthetic cumulative source',
      );
      expect(channels.total.itemized[1]?.awarded).toBe(
        names.includes('Course II') &&
          (names.includes('Course I') || names.includes('Reviewed equivalent I'))
          ? 1
          : 0,
      );
    },
  );
  it('never permits preferences to compensate for missing qualification', () => {
    const { result } = evaluateEligibilityWithTrace(
      member('Numeric', 'Course I', 'Course II', 'Independent course'),
      rule,
    );
    expect(result).toMatchObject({ eligible: false, points: 0, breakdown: { itemized: [] } });
  });
  it('does not infer current completion from expired training evidence', () => {
    const { result } = evaluateEligibilityWithTrace(
      {
        ...member('Minimum'),
        scoringEvidence: {
          evaluationOn: '2026-09-19',
          completedCredentialNames: ['Course I', 'Course II'],
        },
      },
      rule,
    );
    expect(result.points).toBe(0);
  });
});

describe('source-qualified preference exclusions', () => {
  it('excludes secondary cumulative credits for a holder of the preferred qualification', () => {
    const configured = structuredClone(rule);
    const group = configured.pointsPreference.scoring?.total[1];
    if (!group) throw new Error('Expected cumulative group');
    group.excludesAny = ['Preferred qualification'];
    const { result, channels } = evaluateEligibilityWithTrace(
      member(
        'Minimum',
        'Numeric',
        'Course I',
        'Course II',
        'Independent course',
        'Preferred qualification',
      ),
      configured,
    );
    expect(result.points).toBe(7);
    expect(channels.total.itemized[1]).toMatchObject({
      awarded: 0,
      reason: expect.stringContaining('excluded by held qualification: Preferred qualification'),
    });
    expect(
      evaluateEligibilityWithTrace(
        member('Minimum', 'Numeric', 'Course I', 'Course II', 'Independent course'),
        configured,
      ).result.points,
    ).toBe(9);
  });
  it('applies the same explicit exclusion to numeric groups without changing other channels', () => {
    const configured = structuredClone(rule);
    const group = configured.pointsPreference.scoring?.total[0];
    if (!group) throw new Error('Expected numeric group');
    group.excludesAny = ['Preferred qualification'];
    expect(
      evaluateEligibilityWithTrace(
        member('Minimum', 'Numeric', 'Independent course', 'Preferred qualification'),
        configured,
      ).result.points,
    ).toBe(1);
  });
});
