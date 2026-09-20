import { describe, expect, it } from 'vitest';
import { evaluateEligibility, evaluateEligibilityWithTrace } from '../src/evaluate.js';
import { type ComparableResult, compare, compareWithTrace } from '../src/tie-break.js';
import type { Member, PositionRule, TieBreakKey } from '../src/types.js';

const member: Member = {
  memberId: 901,
  employeeId: 'synthetic-trace',
  firstName: 'Synthetic',
  lastName: 'Trace',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 2,
  isProbationary: false,
  credentials: [
    { name: 'Rope Rescue Operations' },
    { name: 'Rope Rescue Technician' },
    { name: 'Hazmat Awareness Level' },
    { name: 'Open Water Diver Certified' },
  ],
};
const rule: PositionRule = {
  positionId: 'synthetic-trace-position',
  ruleBookVersion: 'synthetic-trace-rule',
  requiredCriteria: { rank: ['FF'], credentials: [], custom: [] },
  pointsPreference: {
    max: 3,
    items: [
      { credential: 'Rope Rescue Operations', points: 2, requiresOpsPair: false },
      { credential: 'Rope Rescue Technician', points: 4, requiresOpsPair: true },
    ],
  },
  tieBreakChain: ['points', 'so_points', 'mo_points', 'rsc_seniority', 'rank_seniority'],
};
const comparable = (patch: Partial<ComparableResult> = {}): ComparableResult => ({
  eligible: true,
  reasons: [],
  points: 5,
  soPoints: 4,
  moPoints: 3,
  rscSeniority: 20,
  rankSeniority: 10,
  breakdown: { total: 5, soTotal: 4, moTotal: 3, itemized: [] },
  ...patch,
});

describe('authoritative eligibility and comparator decision trace', () => {
  it('retains legacy result bytes and pre-cap awards while itemizing all three channels', () => {
    const traced = evaluateEligibilityWithTrace(member, rule);
    expect(JSON.stringify(traced.result)).toBe(JSON.stringify(evaluateEligibility(member, rule)));
    expect(traced.result).toMatchObject({ eligible: true, points: 3, soPoints: 2, moPoints: 2 });
    expect(traced.channels.total).toEqual({
      total: 3,
      itemized: [
        { credential: 'Rope Rescue Operations', awarded: 2 },
        { credential: 'Rope Rescue Technician', awarded: 4 },
      ],
    });
    expect(traced.channels.so).toEqual({
      total: 2,
      itemized: [
        { credential: 'Rope Rescue Operations', awarded: 1 },
        { credential: 'Rope Rescue Technician', awarded: 1 },
      ],
    });
    expect(traced.channels.mo).toEqual({
      total: 2,
      itemized: [
        { credential: 'Open Water Diver Certified', awarded: 1 },
        {
          credential: 'Hazardous Materials Operations',
          awarded: 1,
          reason: 'Equivalent qualification: Hazmat Awareness Level',
        },
      ],
    });
  });
  it('does not credit an alternate twice or mislabel a directly held qualification', () => {
    const traced = evaluateEligibilityWithTrace(
      {
        ...member,
        credentials: [
          ...member.credentials,
          { name: 'Hazardous Materials Operations' },
          { name: 'Hazmat Awareness Level' },
        ],
      },
      rule,
    );
    expect(traced.channels.mo).toEqual({
      total: 2,
      itemized: [
        { credential: 'Open Water Diver Certified', awarded: 1 },
        { credential: 'Hazardous Materials Operations', awarded: 1 },
      ],
    });
    expect(traced.result.moPoints).toBe(2);
  });
  it('keeps blocked qualification gates separate from potential scoring', () => {
    const traced = evaluateEligibilityWithTrace({ ...member, rank: 'CPT' }, rule);
    expect(traced.result.eligible).toBe(false);
    expect(traced.channels).toEqual({
      total: { total: 0, itemized: [] },
      so: { total: 0, itemized: [] },
      mo: { total: 0, itemized: [] },
    });
    expect(traced.result.reasons).toContainEqual(
      expect.objectContaining({ code: 'RANK_REQUIRED', satisfied: false }),
    );
  });
  it('keeps configured caps and award order independently for total, SO and MO', () => {
    const item = (credential: string, points: number) => ({
      credential,
      alternatives: [],
      requiresAll: [],
      points,
    });
    const configured: PositionRule = {
      ...rule,
      pointsPreference: {
        max: 0,
        items: [],
        scoring: {
          v: 1,
          total: [
            {
              id: 'total',
              cap: 3,
              items: [item('Rope Rescue Operations', 2), item('Rope Rescue Technician', 4)],
            },
          ],
          so: [{ id: 'so', cap: 1, items: [item('Rope Rescue Technician', 5)] }],
          mo: [{ id: 'mo', cap: null, items: [item('Open Water Diver Certified', 7)] }],
        },
      },
    };
    const traced = evaluateEligibilityWithTrace(member, configured);
    expect(traced.result).toMatchObject({ points: 3, soPoints: 1, moPoints: 7 });
    expect(traced.channels.total.itemized.map((item) => item.awarded)).toEqual([2, 1]);
    expect(traced.channels.so.itemized[0]?.awarded).toBe(1);
    expect(traced.channels.mo.itemized[0]?.awarded).toBe(7);
    expect(JSON.stringify(traced.result)).toBe(
      JSON.stringify(evaluateEligibility(member, configured)),
    );
  });
  const decisions: {
    key: TieBreakKey;
    patch: Partial<ComparableResult>;
    expected: -1 | 1;
    direction: string;
  }[] = [
    { key: 'points', patch: { points: 6 }, expected: -1, direction: 'HIGHER_FIRST' },
    { key: 'so_points', patch: { soPoints: 3 }, expected: 1, direction: 'HIGHER_FIRST' },
    { key: 'mo_points', patch: { moPoints: 4 }, expected: -1, direction: 'HIGHER_FIRST' },
    { key: 'rsc_seniority', patch: { rscSeniority: 21 }, expected: 1, direction: 'LOWER_FIRST' },
    { key: 'rank_seniority', patch: { rankSeniority: 9 }, expected: -1, direction: 'LOWER_FIRST' },
  ];
  it.each(decisions)(
    'visits the configured $key step and stops at its decision',
    ({ key, patch, expected, direction }) => {
      const a = comparable(patch);
      const b = comparable();
      const trace = compareWithTrace(a, b, rule.tieBreakChain);
      expect(trace.result).toBe(expected);
      expect(compare(a, b, rule.tieBreakChain)).toBe(expected);
      expect(trace.steps.at(-1)).toMatchObject({ key, result: expected, direction });
      expect(trace.steps).toHaveLength(rule.tieBreakChain.indexOf(key) + 1);
      expect(trace.steps.slice(0, -1).every((step) => step.result === 0)).toBe(true);
    },
  );
  it('retains a complete unresolved tie, including the empty configured chain', () => {
    expect(compareWithTrace(comparable(), comparable(), rule.tieBreakChain)).toMatchObject({
      result: 0,
      steps: rule.tieBreakChain.map((key) => expect.objectContaining({ key, result: 0 })),
    });
    expect(compareWithTrace(comparable({ points: 500 }), comparable(), [])).toEqual({
      result: 0,
      steps: [],
    });
  });
});
