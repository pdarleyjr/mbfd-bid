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
