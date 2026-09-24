import { describe, expect, it } from 'vitest';
import { type Member, type PositionRule, evaluateEligibilityCohort } from '../../src/index.js';

const rule: PositionRule = {
  positionId: 'A611',
  ruleBookVersion: '2026.3',
  requiredCriteria: { rank: ['CPT'], credentials: ['Required'], custom: [] },
  pointsPreference: {
    max: 1,
    items: [{ credential: 'Preferred', points: 1, requiresOpsPair: false }],
  },
  tieBreakChain: ['points', 'time_in_grade_bid_ordinal'],
};

function member(employeeId: string, credentials: Member['credentials'], ordinal?: number): Member {
  return {
    employeeId,
    firstName: employeeId,
    lastName: 'Member',
    rank: 'CPT',
    rscSeniority: 1,
    rankSeniority: 1,
    bidOrdinalEvidence:
      ordinal === undefined
        ? undefined
        : {
            datasetId: 'reviewed',
            sourceSha256: 'a'.repeat(64),
            timeInGrade: ordinal,
            departmentService: ordinal,
          },
    isProbationary: false,
    credentials,
  };
}

describe('evaluateEligibilityCohort', () => {
  it('orders only qualified members and keeps failures in a separate exclusion view', () => {
    const result = evaluateEligibilityCohort({
      asOf: '2026-09-24',
      rule,
      members: [
        member('second', [{ name: 'Required' }], 2),
        member('first', [{ name: 'Required' }, { name: 'Preferred' }], 4),
        member('missing', [], 1),
      ],
    });
    expect(result.eligible.map((entry) => entry.member.employeeId)).toEqual(['first', 'second']);
    expect(result.eligible.map((entry) => entry.priority)).toEqual([1, 2]);
    expect(result.excluded.map((entry) => entry.member.employeeId)).toEqual(['missing']);
  });

  it('fails closed for expired requirements and missing reviewed ordering evidence', () => {
    const result = evaluateEligibilityCohort({
      asOf: '2026-09-24',
      rule,
      members: [
        member('expired', [{ name: 'Required', status: 'active', expiresOn: '2026-09-23' }], 1),
        member('unknown-order', [{ name: 'Required' }]),
      ],
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded[0]?.result.reasons).toContainEqual(
      expect.objectContaining({ code: 'CRED_EXPIRED', satisfied: false }),
    );
    expect(result.dataBlocked[0]?.dataBlockers).toContain(
      'Missing reviewed ordering evidence: time_in_grade_bid_ordinal',
    );
  });

  it('does not invent a member-id tiebreak when the policy chain ties', () => {
    const result = evaluateEligibilityCohort({
      asOf: '2026-09-24',
      rule,
      members: [member('one', [{ name: 'Required' }], 1), member('two', [{ name: 'Required' }], 1)],
    });
    expect(result.eligible).toEqual([]);
    expect(result.dataBlocked).toHaveLength(2);
    expect(
      result.dataBlocked.every((entry) =>
        entry.dataBlockers.includes('Policy ordering chain leaves this member tied'),
      ),
    ).toBe(true);
  });
});
