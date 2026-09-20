import type { Member, PositionRule } from '@mbfd/eligibility';
import { FrozenAnnualSpecialtyPolicySchema } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { evaluateImpactCohort } from '../../src/lib/annual-eligibility-impact.js';
import {
  type FrozenSpecialtyCandidateFact,
  rankFrozenSpecialtyCandidates,
} from '../../src/lib/annual-specialty-policy.js';
import { decodePositionRule } from '../../src/lib/position-rule.js';

const evidence = (timeInGrade: number, departmentService: number) => ({
  datasetId: 'synthetic-reviewed-source',
  sourceSha256: 'b'.repeat(64),
  timeInGrade,
  departmentService,
});
const specialty = FrozenAnnualSpecialtyPolicySchema.parse({
  id: 'synthetic-specialty',
  label: 'Synthetic specialty',
  mode: 'INTERRUPTING',
  opportunityPositionIds: ['A101'],
  requiredCredentialNames: ['Synthetic minimum'],
  requiredSpecialtyCodes: [],
  points: [],
  tieBreakChain: ['TIME_IN_GRADE_BID_ORDINAL'],
});
const fact = (
  memberId: number,
  timeInGrade: number,
  departmentService: number,
): FrozenSpecialtyCandidateFact => ({
  memberId,
  rscSeniority: memberId,
  rankSeniority: memberId,
  credentialNames: ['Synthetic minimum'],
  specialtyQualifications: [],
  bidOrdinalEvidence: evidence(timeInGrade, departmentService),
});
const rank = (members: FrozenSpecialtyCandidateFact[], key = 'TIME_IN_GRADE_BID_ORDINAL') =>
  rankFrozenSpecialtyCandidates({
    policy: FrozenAnnualSpecialtyPolicySchema.parse({ ...specialty, tieBreakChain: [key] }),
    evaluationOn: '2027-01-01',
    members,
  });
const rule: PositionRule = {
  positionId: 'A101',
  ruleBookVersion: 'synthetic',
  requiredCriteria: { rank: ['FF'], credentials: [], custom: [] },
  pointsPreference: { max: 0, items: [] },
  tieBreakChain: ['time_in_grade_bid_ordinal'],
};
const member = (memberId: number, ordinal?: ReturnType<typeof evidence>) => ({
  memberId,
  evidence: {
    memberId,
    employeeId: `synthetic-${memberId}`,
    firstName: 'Synthetic',
    lastName: 'Member',
    rank: 'FF',
    rscSeniority: memberId,
    rankSeniority: memberId,
    credentials: [],
    isProbationary: false,
    bidOrdinalEvidence: ordinal,
  } satisfies Member,
});

describe('Bid ordinal ranking projection', () => {
  it('ranks specialty candidates by the explicitly selected reviewed domain', () => {
    expect(rank([fact(1, 2, 1), fact(2, 1, 2)]).map((row) => row.memberId)).toEqual([2, 1]);
    expect(
      rank([fact(1, 2, 1), fact(2, 1, 2)], 'DEPARTMENT_SERVICE_BID_ORDINAL').map(
        (row) => row.memberId,
      ),
    ).toEqual([1, 2]);
  });
  it('fails closed for a qualified singleton missing ordinals and for an unresolved tie', () => {
    expect(() => rank([{ ...fact(1, 1, 1), bidOrdinalEvidence: undefined }])).toThrow(
      'SPECIALTY_BID_ORDINAL_EVIDENCE_MISSING',
    );
    expect(() => rank([fact(1, 1, 1), fact(2, 1, 2)])).toThrow('SPECIALTY_TIE_UNRESOLVED');
  });
  it('does not require ordering facts from an ineligible specialty member', () => {
    expect(
      rank([
        fact(1, 1, 1),
        { ...fact(2, 2, 2), credentialNames: [], bidOrdinalEvidence: undefined },
      ]),
    ).toEqual([{ memberId: 1, points: 0 }]);
  });
  it('projects reviewed ordinary priorities and preserves ties without member-id fallback', () => {
    const ranked = evaluateImpactCohort(
      [member(1, evidence(2, 1)), member(2, evidence(1, 2))],
      rule,
    );
    expect([ranked.get(1)?.priority, ranked.get(2)?.priority]).toEqual([2, 1]);
    const tied = evaluateImpactCohort([member(1, evidence(1, 1)), member(2, evidence(1, 2))], rule);
    expect([tied.get(1)?.priority, tied.get(2)?.priority]).toEqual([1, 1]);
  });
  it('leaves cohort priority unavailable when required evidence is missing, without fabricating ineligibility', () => {
    const ranked = evaluateImpactCohort([member(1), member(2, evidence(1, 2))], rule);
    for (const row of ranked.values()) {
      expect(row.eligible).toBe(true);
      expect(row.priority).toBeNull();
      expect(row.reasons).toContain(
        'Bid priority unavailable: required reviewed Bid ordinal evidence is missing in this cohort.',
      );
    }
  });
  it('decodes both new reusable rule keys while retaining historical keys', () => {
    expect(
      decodePositionRule({
        positionId: 'A101',
        ruleBookVersion: 'synthetic',
        requiredCriteriaJson: JSON.stringify(rule.requiredCriteria),
        pointsPreferenceJson: JSON.stringify(rule.pointsPreference),
        tieBreakChainJson: JSON.stringify([
          'points',
          'time_in_grade_bid_ordinal',
          'department_service_bid_ordinal',
        ]),
      }),
    ).toMatchObject({
      ok: true,
      rule: {
        tieBreakChain: ['points', 'time_in_grade_bid_ordinal', 'department_service_bid_ordinal'],
      },
    });
    expect(
      rank([fact(1, 2, 1), fact(2, 1, 2)], 'RSC_SENIORITY').map((row) => row.memberId),
    ).toEqual([1, 2]);
  });
});
