import type { FrozenAnnualSpecialtyPolicy } from '@mbfd/shared';
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
