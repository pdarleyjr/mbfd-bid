import { describe, expect, it } from 'vitest';
import { decodePositionRule } from '../../src/lib/position-rule.js';

const validCriteria = {
  rank: ['FF'],
  credentials: ['IADRS Swim Evaluation'],
  custom: ['non_probationary'],
};

const validPoints = {
  max: 2,
  items: [{ points: 1, credential: 'Driver Engineer Qualified' }],
};

const validTieBreak = ['points', 'rsc_seniority', 'rank_seniority'];

function row(
  overrides: Partial<{
    positionId: unknown;
    ruleBookVersion: unknown;
    requiredCriteriaJson: unknown;
    pointsPreferenceJson: unknown;
    tieBreakChainJson: unknown;
  }> = {},
) {
  return {
    positionId: ' A101 ',
    ruleBookVersion: ' 2026.1 ',
    requiredCriteriaJson: JSON.stringify(validCriteria),
    pointsPreferenceJson: JSON.stringify(validPoints),
    tieBreakChainJson: JSON.stringify(validTieBreak),
    ...overrides,
  };
}

function expectSuccess(result: ReturnType<typeof decodePositionRule>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected decoded rule, got ${JSON.stringify(result.issues)}`);
  return result.rule;
}

describe('decodePositionRule', () => {
  it('decodes all persisted JSON columns, trims outer whitespace only, and maps ops_all_6', () => {
    const result = expectSuccess(
      decodePositionRule(
        row({
          requiredCriteriaJson: JSON.stringify({
            rank: [' FF '],
            credentials: [' IADRS  Swim Evaluation '],
            custom: [' non_probationary '],
          }),
          pointsPreferenceJson: JSON.stringify({
            max: 1,
            items: [
              {
                points: 1,
                credential: ' Rope Rescue Technician ',
                gating: 'ops_all_6',
              },
            ],
          }),
        }),
      ),
    );

    expect(result).toEqual({
      positionId: 'A101',
      ruleBookVersion: '2026.1',
      requiredCriteria: {
        rank: ['FF'],
        credentials: ['IADRS  Swim Evaluation'],
        custom: ['non_probationary'],
      },
      pointsPreference: {
        max: 1,
        items: [
          {
            points: 1,
            credential: 'Rope Rescue Technician',
            requiresOpsPair: false,
            opsGate: 'all_operations',
          },
        ],
      },
      tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
    });
  });

  it('accepts canonical opsGate and legacy requiresOpsPair only when their meanings agree', () => {
    const result = expectSuccess(
      decodePositionRule(
        row({
          pointsPreferenceJson: JSON.stringify({
            max: 4,
            items: [
              {
                points: 1,
                credential: 'Rope Rescue Technician',
                opsGate: 'paired_operation',
              },
              {
                points: 1,
                credential: 'HazMat Technician',
                opsGate: 'all_operations',
                requiresOpsPair: false,
              },
              {
                points: 1,
                credential: 'Drone Operator',
                requiresOpsPair: false,
              },
              {
                points: 1,
                credential: 'Structural Collapse Technician',
                requiresOpsPair: true,
              },
            ],
          }),
        }),
      ),
    );

    expect(result.pointsPreference.items).toEqual([
      {
        points: 1,
        credential: 'Rope Rescue Technician',
        requiresOpsPair: true,
        opsGate: 'paired_operation',
      },
      {
        points: 1,
        credential: 'HazMat Technician',
        requiresOpsPair: false,
        opsGate: 'all_operations',
      },
      {
        points: 1,
        credential: 'Drone Operator',
        requiresOpsPair: false,
      },
      {
        points: 1,
        credential: 'Structural Collapse Technician',
        requiresOpsPair: true,
      },
    ]);
  });

  it.each([
    {
      label: 'an unknown legacy gating value',
      pointsPreference: {
        max: 1,
        items: [{ points: 1, credential: 'Credential', gating: 'pairwise' }],
      },
    },
    {
      label: 'a misspelled gate field that would otherwise be ignored',
      pointsPreference: {
        max: 1,
        items: [{ points: 1, credential: 'Credential', gateing: 'ops_all_6' }],
      },
    },
    {
      label: 'conflicting gating and canonical opsGate values',
      pointsPreference: {
        max: 1,
        items: [
          {
            points: 1,
            credential: 'Credential',
            gating: 'ops_all_6',
            opsGate: 'paired_operation',
          },
        ],
      },
    },
    {
      label: 'conflicting canonical opsGate and legacy requiresOpsPair values',
      pointsPreference: {
        max: 1,
        items: [
          {
            points: 1,
            credential: 'Credential',
            opsGate: 'all_operations',
            requiresOpsPair: true,
          },
        ],
      },
    },
  ])('rejects $label', ({ pointsPreference }) => {
    const result = decodePositionRule(
      row({ pointsPreferenceJson: JSON.stringify(pointsPreference) }),
    );

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.issues[0]?.code).toMatch(/unknown_field|unknown_gating|conflicting_gating/);
    }
  });

  it.each(['pre_bid_pool', 'unapproved_custom_condition'])(
    'rejects unsupported custom criterion %s instead of silently ignoring it',
    (custom) => {
      const result = decodePositionRule(
        row({
          requiredCriteriaJson: JSON.stringify({
            ...validCriteria,
            custom: [custom],
          }),
        }),
      );

      expect(result).toMatchObject({ ok: false });
      if (!result.ok)
        expect(result.issues).toContainEqual(
          expect.objectContaining({ code: 'unsupported_custom' }),
        );
    },
  );

  it.each([
    {
      label: 'an invalid rank',
      overrides: {
        requiredCriteriaJson: JSON.stringify({ ...validCriteria, rank: ['FIRE_CHIEF'] }),
      },
      code: 'invalid_rank',
    },
    {
      label: 'an invalid tie-break key',
      overrides: { tieBreakChainJson: JSON.stringify(['points', 'coin_flip']) },
      code: 'invalid_tie_break',
    },
    {
      label: 'malformed JSON',
      overrides: { pointsPreferenceJson: '{not-json' },
      code: 'malformed_json',
    },
  ])('returns a structured failure for $label', ({ overrides, code }) => {
    const result = decodePositionRule(row(overrides));

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code }));
  });
});
