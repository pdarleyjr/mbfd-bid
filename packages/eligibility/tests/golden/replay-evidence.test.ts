import { describe, expect, it } from 'vitest';
import type { Member, PositionRule } from '../../src/types.js';
import { type ReplayManifest, replayEvidence } from './replay-evidence.js';

const member: Member = {
  employeeId: 'synthetic',
  firstName: '',
  lastName: '',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary: false,
  credentials: [{ name: 'Test credential' }],
};
const rule: PositionRule = {
  positionId: 'synthetic-seat',
  ruleBookVersion: '2025.1',
  requiredCriteria: { rank: ['FF'], credentials: [], custom: [] },
  pointsPreference: {
    max: 3,
    items: [{ credential: 'Test credential', points: 5, requiresOpsPair: false }],
  },
  tieBreakChain: ['points'],
};
const expected = {
  caseId: 'cap',
  employeeId: member.employeeId,
  positionId: rule.positionId,
  sourceLocation: 'synthetic-cap',
  authority: 'approved_expectation' as const,
  eligible: true,
  points: 3,
  soPoints: 0,
  moPoints: 0,
};
const manifest: ReplayManifest = {
  v: 1,
  source: 'Synthetic harness test only; not historical evidence',
  fixtureSha256: {},
  exclusions: [],
  cases: [expected],
};

describe('replay evidence completeness', () => {
  it('checks both sides of an explicitly sourced amendment without reinterpreting the old rule', () => {
    const amended = {
      ...rule,
      ruleBookVersion: '2025.2',
      pointsPreference: { ...rule.pointsPreference, max: 2 },
    };
    const before = { ...expected, caseId: 'before', ruleBookVersion: rule.ruleBookVersion };
    const after = {
      ...expected,
      caseId: 'after',
      ruleBookVersion: amended.ruleBookVersion,
      points: 2,
    };
    const evidence = {
      ...manifest,
      cases: [before, after],
      amendments: [
        {
          caseId: 'amendment',
          sourceLocation: 'synthetic approved amendment only',
          beforeCaseId: 'before',
          afterCaseId: 'after',
        },
      ],
    };
    const originalBytes = JSON.stringify(rule);
    expect(replayEvidence([member], [rule, amended], evidence)).toMatchObject({
      evaluated: 2,
      evaluatedAmendments: 1,
      failures: [],
    });
    expect(JSON.stringify(rule)).toBe(originalBytes);
    expect(
      replayEvidence([member], [rule, amended], {
        ...evidence,
        cases: [before, { ...after, points: 3 }],
      }).approvedFailures,
    ).toEqual(['after:points']);
    expect(() =>
      replayEvidence([member], [rule, amended], { ...evidence, cases: [before] }),
    ).toThrow('missing a before or after');
    expect(() =>
      replayEvidence([member], [rule, amended], {
        ...evidence,
        cases: [before, { ...after, ruleBookVersion: rule.ruleBookVersion, points: 3 }],
      }),
    ).toThrow('explicit different rule versions');
    expect(() => replayEvidence([member], [rule, amended], manifest)).toThrow(
      'unambiguous rule version',
    );
  });
  it('reports observed differences separately from approved expectation failures', () => {
    const evidence = {
      ...manifest,
      cases: [
        { ...expected, caseId: 'observed', authority: 'observed_award' as const, points: 5 },
        { ...expected, caseId: 'approved', points: 4 },
      ],
    };
    expect(replayEvidence([member], [rule], evidence)).toMatchObject({
      observedCases: 1,
      approvedCases: 1,
      observedDifferences: ['observed:points'],
      approvedFailures: ['approved:points'],
      failures: ['observed:points', 'approved:points'],
    });
  });
  it('checks expected ordering and preserves unresolved ties without using an identity tie-break', () => {
    const second = { ...member, employeeId: 'synthetic-second' };
    const ordering = {
      caseId: 'source-order',
      sourceLocation: 'synthetic ordered rows',
      authority: 'observed_award' as const,
      positionId: rule.positionId,
      candidateEmployeeIds: [second.employeeId, member.employeeId],
      expectedPriorityGroups: [[member.employeeId, second.employeeId]],
    };
    expect(
      replayEvidence([member, second], [rule], { ...manifest, orderings: [ordering] }),
    ).toMatchObject({ evaluatedOrderings: 1, failures: [] });
    expect(
      replayEvidence([member, second], [rule], {
        ...manifest,
        orderings: [
          { ...ordering, expectedPriorityGroups: [[member.employeeId], [second.employeeId]] },
        ],
      }).failures,
    ).toEqual(['source-order:ordering']);
    const ranked = {
      ...rule,
      tieBreakChain: ['points', 'rsc_seniority'] as PositionRule['tieBreakChain'],
    };
    expect(
      replayEvidence([member, { ...second, rscSeniority: 2 }], [ranked], {
        ...manifest,
        orderings: [
          { ...ordering, expectedPriorityGroups: [[member.employeeId], [second.employeeId]] },
        ],
      }).failures,
    ).toEqual([]);
    expect(() => replayEvidence([member], [rule], { ...manifest, orderings: [ordering] })).toThrow(
      'missing a member',
    );
  });
  it('rejects zero cases and missing members or rules', () => {
    expect(() => replayEvidence([member], [rule], { ...manifest, cases: [] })).toThrow('nonzero');
    expect(() => replayEvidence([], [rule], manifest)).toThrow('missing');
    expect(() => replayEvidence([member], [], manifest)).toThrow('missing');
  });
  it('checks scores and negative eligibility, not merely absence of false negatives', () => {
    expect(replayEvidence([member], [rule], manifest)).toMatchObject({
      evaluated: 1,
      failures: [],
    });
    expect(
      replayEvidence([member], [rule], { ...manifest, cases: [{ ...expected, points: 5 }] })
        .failures,
    ).toEqual(['cap:points']);
    const negative = { ...manifest, cases: [{ ...expected, eligible: false, points: 0 }] };
    expect(
      replayEvidence(
        [member],
        [{ ...rule, requiredCriteria: { ...rule.requiredCriteria, rank: ['CPT'] } }],
        negative,
      ),
    ).toMatchObject({ negativeCases: 1, failures: [] });
  });
});
