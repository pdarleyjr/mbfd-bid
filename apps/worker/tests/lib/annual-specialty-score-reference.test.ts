import type { FrozenAnnualSpecialtyPolicy, FrozenScoreReferenceEvidence } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  type FrozenSpecialtyCandidateFact,
  rankFrozenSpecialtyCandidates,
} from '../../src/lib/annual-specialty-policy.js';

const policy: FrozenAnnualSpecialtyPolicy = {
  id: 'synthetic-specialty',
  label: 'Synthetic specialty',
  mode: 'INTERRUPTING',
  opportunityPositionIds: ['P1', 'P2'],
  requiredCredentialNames: ['Required Qualification'],
  requiredSpecialtyCodes: ['SPECIALTY'],
  points: [{ credentialName: 'Required Qualification', value: 1 }],
  tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
};
const reference = (
  patch: Partial<FrozenScoreReferenceEvidence> = {},
): FrozenScoreReferenceEvidence => ({
  v: 1,
  listId: 'SYNTHETIC_FINAL',
  positionIds: ['P1', 'P2'],
  points: 12,
  soPoints: 6,
  moPoints: 3,
  sourceName: 'Synthetic ranking.pdf',
  sourceSha256: 'a'.repeat(64),
  sourceLocation: { page: 1, textLine: 10 },
  literalTotal: 12,
  printedBidOrder: 20,
  sourcePriority: 1,
  ...patch,
});
const member = (memberId: number, patch: Partial<FrozenScoreReferenceEvidence> = {}) => ({
  memberId,
  rscSeniority: memberId,
  rankSeniority: memberId,
  credentialNames: ['Required Qualification'],
  specialtyQualifications: [
    {
      specialtyCode: 'SPECIALTY',
      status: 'active' as const,
      effectiveOn: '2020-01-01',
      expiresOn: null,
    },
  ],
  scoreReferenceEvidence: [reference(patch)],
});
const rank = (
  members: FrozenSpecialtyCandidateFact[],
  override: Partial<FrozenAnnualSpecialtyPolicy> = {},
) =>
  rankFrozenSpecialtyCandidates({
    policy: { ...policy, ...override },
    evaluationOn: '2026-10-05',
    members,
  });

describe('frozen specialty source ranking', () => {
  it('shares exact-position source priority with ordinary eligibility, ahead of points and seniority', () => {
    expect(
      rank([
        member(1, { sourcePriority: 2, points: 20 }),
        member(2, { sourcePriority: 1, points: 1 }),
      ]),
    ).toEqual([
      { memberId: 2, points: 1 },
      { memberId: 1, points: 20 },
    ]);
  });
  it('uses the configured ranking channel for published source values', () => {
    for (const [rankingChannel, points] of [
      ['total', 12],
      ['so', 6],
      ['mo', 3],
    ] as const) {
      expect(
        rank([member(1)], {
          points: [],
          rankingChannel,
          scoring: { v: 1, total: [], so: [], mo: [] },
        }),
      ).toEqual([{ memberId: 1, points }]);
    }
  });
  it('never grants specialty eligibility for missing or expired qualifications', () => {
    expect(
      rank([
        { ...member(1), credentialNames: [] },
        {
          ...member(2),
          specialtyQualifications: [
            {
              specialtyCode: 'SPECIALTY',
              status: 'expired',
              effectiveOn: '2020-01-01',
              expiresOn: '2025-12-31',
            },
          ],
        },
      ]),
    ).toEqual([]);
  });
  it('preserves unchanged ranking when a source applies to a different position', () => {
    expect(rank([member(1, { positionIds: ['P3'] })])).toEqual([{ memberId: 1, points: 1 }]);
  });
  it('rejects partial policy scopes, inconsistent member channels and mixed-source cohorts', () => {
    expect(() => rank([member(1, { positionIds: ['P1'] })])).toThrow(
      'SCORE_REFERENCE_SCOPE_INCOMPLETE',
    );
    const mixed = {
      ...member(1),
      scoreReferenceEvidence: [
        reference({ positionIds: ['P1'] }),
        reference({ positionIds: ['P2'], points: 11 }),
      ],
    };
    expect(() => rank([mixed])).toThrow('SCORE_REFERENCE_SCOPE_INCONSISTENT');
    expect(() => rank([member(1), member(2, { listId: 'OTHER', sourcePriority: 2 })])).toThrow(
      'SCORE_REFERENCE_COHORT_MISMATCH',
    );
  });
});
