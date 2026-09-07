import { configuredChannel } from '@mbfd/eligibility';
import { type FrozenAnnualSpecialtyPolicy, FrozenAnnualSpecialtyPolicySchema } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  higherPriorityFrozenSpecialtyCandidates,
  rankFrozenSpecialtyCandidates,
} from '../../src/lib/annual-specialty-policy.js';

const policy: FrozenAnnualSpecialtyPolicy = {
  id: 'marine-call-down',
  label: 'Marine call-down',
  mode: 'INTERRUPTING',
  opportunityPositionIds: ['M-1'],
  requiredCredentialNames: ['Marine'],
  requiredSpecialtyCodes: ['MARINE'],
  points: [{ credentialName: 'Marine', value: 8 }],
  tieBreakChain: ['POINTS', 'RSC_SENIORITY', 'RANK_SENIORITY'],
};

describe('annual specialty policy', () => {
  it('uses the same capped, alternative and prerequisite scoring as ordinary positions while preserving legacy semantics', () => {
    const groups = [
      {
        id: 'reviewed',
        cap: 5,
        items: [
          {
            credential: 'Synthetic Technician',
            alternatives: ['Synthetic Equivalent'],
            requiresAll: ['Synthetic Operation'],
            points: 4,
          },
          { credential: 'Marine', alternatives: [], requiresAll: [], points: 3 },
        ],
      },
    ];
    const configured = {
      ...policy,
      requiredSpecialtyCodes: [],
      points: [],
      rankingChannel: 'so' as const,
      scoring: { v: 1 as const, total: [], so: groups, mo: [] },
    };
    const members = [
      {
        memberId: 1,
        rscSeniority: 1,
        rankSeniority: 1,
        credentialNames: ['Marine', 'Synthetic Equivalent'],
        specialtyQualifications: [],
      },
      {
        memberId: 2,
        rscSeniority: 2,
        rankSeniority: 2,
        credentialNames: ['Marine', 'Synthetic Equivalent', 'Synthetic Operation'],
        specialtyQualifications: [],
      },
    ];
    expect(FrozenAnnualSpecialtyPolicySchema.safeParse(configured).success).toBe(true);
    const ranked = rankFrozenSpecialtyCandidates({
      policy: configured,
      evaluationOn: '2027-01-01',
      members,
    });
    expect(ranked).toEqual([
      { memberId: 2, points: 5 },
      { memberId: 1, points: 3 },
    ]);
    for (const result of ranked) {
      const member = members.find((m) => m.memberId === result.memberId);
      if (!member) throw new Error('Synthetic candidate missing');
      expect(result.points).toBe(
        configuredChannel({ credentials: member.credentialNames.map((name) => ({ name })) }, groups)
          .total,
      );
    }
    expect(
      rankFrozenSpecialtyCandidates({
        policy: { ...policy, requiredSpecialtyCodes: [] },
        evaluationOn: '2027-01-01',
        members,
      }),
    ).toEqual([
      { memberId: 1, points: 8 },
      { memberId: 2, points: 8 },
    ]);
    expect(
      FrozenAnnualSpecialtyPolicySchema.safeParse({ ...configured, points: policy.points }).success,
    ).toBe(false);
    expect(
      FrozenAnnualSpecialtyPolicySchema.safeParse({ ...configured, rankingChannel: undefined })
        .success,
    ).toBe(false);
  });
  it('derives deterministic candidate order from frozen facts and excludes expired evidence', () => {
    const result = rankFrozenSpecialtyCandidates({
      policy,
      evaluationOn: '2026-01-15',
      members: [
        {
          memberId: 3,
          rscSeniority: 4,
          rankSeniority: 4,
          credentialNames: ['Marine'],
          specialtyQualifications: [
            {
              specialtyCode: 'MARINE',
              status: 'active',
              effectiveOn: '2020-01-01',
              expiresOn: null,
            },
          ],
        },
        {
          memberId: 2,
          rscSeniority: 6,
          rankSeniority: 2,
          credentialNames: ['Marine'],
          specialtyQualifications: [
            {
              specialtyCode: 'MARINE',
              status: 'expired',
              effectiveOn: '2020-01-01',
              expiresOn: '2025-12-31',
            },
          ],
        },
        {
          memberId: 1,
          rscSeniority: 7,
          rankSeniority: 1,
          credentialNames: ['Marine'],
          specialtyQualifications: [
            {
              specialtyCode: 'MARINE',
              status: 'active',
              effectiveOn: '2020-01-01',
              expiresOn: null,
            },
          ],
        },
      ],
    });

    expect(result).toEqual([
      { memberId: 3, points: 8 },
      { memberId: 1, points: 8 },
    ]);
  });

  it('fails closed when a policy asks for an unsupported tiebreak', () => {
    expect(() =>
      rankFrozenSpecialtyCandidates({
        policy: { ...policy, tieBreakChain: ['POINTS', 'UNCONFIGURED'] as never },
        evaluationOn: '2026-01-15',
        members: [],
      }),
    ).toThrow('SPECIALTY_TIEBREAK_UNCONFIGURED');
  });

  it('calls down only to position-qualified candidates ranked ahead of the requesting bidder', () => {
    const members = [1, 2, 3, 4].map((memberId) => ({
      memberId,
      rscSeniority: memberId,
      rankSeniority: memberId,
      credentialNames: ['Marine'],
      specialtyQualifications: [
        {
          specialtyCode: 'MARINE',
          status: 'active' as const,
          effectiveOn: '2020-01-01',
          expiresOn: null,
        },
      ],
    }));

    expect(
      higherPriorityFrozenSpecialtyCandidates({
        policy,
        evaluationOn: '2026-01-15',
        members,
        requesterMemberId: 3,
        positionEligibleMemberIds: new Set([1, 3, 4]),
      }),
    ).toEqual([{ memberId: 1, points: 8 }]);
  });

  it('does not call down for the top ranked requester and fails closed for an unresolved tie', () => {
    const member = (memberId: number) => ({
      memberId,
      rscSeniority: 1,
      rankSeniority: 1,
      credentialNames: ['Marine'],
      specialtyQualifications: [
        {
          specialtyCode: 'MARINE',
          status: 'active' as const,
          effectiveOn: '2020-01-01',
          expiresOn: null,
        },
      ],
    });
    expect(
      higherPriorityFrozenSpecialtyCandidates({
        policy,
        evaluationOn: '2026-01-15',
        members: [
          { ...member(1), rscSeniority: 1 },
          { ...member(2), rscSeniority: 2 },
        ],
        requesterMemberId: 1,
        positionEligibleMemberIds: new Set([1, 2]),
      }),
    ).toEqual([]);
    expect(() =>
      higherPriorityFrozenSpecialtyCandidates({
        policy,
        evaluationOn: '2026-01-15',
        members: [member(1), member(2)],
        requesterMemberId: 2,
        positionEligibleMemberIds: new Set([1, 2]),
      }),
    ).toThrow('SPECIALTY_TIE_UNRESOLVED');
  });
});
