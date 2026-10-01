import { type Member, type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { eligibilityMemberFromFrozen } from '../../src/lib/bid-policy.js';
import {
  type LegacyCredentialBaseline,
  activeCredentialNamesByMemberAsOf,
  completedCredentialNamesAsOf,
  deriveMemberQualificationProjection,
} from '../../src/lib/qualification-lifecycle.js';

const AWARENESS = 'Hazardous Materials Awareness';
const OPERATIONS = 'Hazardous Materials Operations';
const AS_OF = '2026-09-30';
const MEMBER_ID = 10001;
const rule: PositionRule = {
  positionId: 'synthetic-credential-seat',
  ruleBookVersion: 'synthetic-credential-rulebook',
  requiredCriteria: { rank: ['FF'], credentials: [AWARENESS], custom: [] },
  pointsPreference: { max: 0, items: [] },
  tieBreakChain: ['rsc_seniority'],
};

const awareness: LegacyCredentialBaseline = {
  memberId: MEMBER_ID,
  credentialId: 10001,
  credentialName: AWARENESS,
  startDate: '2026-01-01',
  expirationDate: '2026-12-31',
};
const operations: LegacyCredentialBaseline = {
  ...awareness,
  credentialId: 10002,
  credentialName: OPERATIONS,
};

const cases = [
  {
    label: 'expired Awareness with current Operations',
    rows: [{ ...awareness, expirationDate: '2026-09-29' }, operations],
    eligible: true,
  },
  {
    label: 'current Awareness with expired Operations',
    rows: [awareness, { ...operations, expirationDate: '2026-09-29' }],
    eligible: true,
  },
  {
    label: 'future Awareness with current Operations',
    rows: [{ ...awareness, startDate: '2026-10-01' }, operations],
    eligible: true,
  },
  {
    label: 'both matching credentials expired',
    rows: [
      { ...awareness, expirationDate: '2026-09-29' },
      { ...operations, expirationDate: '2026-09-29' },
    ],
    eligible: false,
  },
  {
    label: 'inclusive effective and expiration boundaries',
    rows: [{ ...awareness, startDate: AS_OF, expirationDate: AS_OF }],
    eligible: true,
  },
];

describe('preview and frozen Live credential minimum parity', () => {
  it.each(cases)('$label agrees at the same configured evaluation date', ({ rows, eligible }) => {
    for (const legacyCredentials of [rows, [...rows].reverse()]) {
      const input = { memberId: MEMBER_ID, asOf: AS_OF, legacyCredentials, events: [] };
      const projection = deriveMemberQualificationProjection(input);
      const scoringEvidence = {
        evaluationOn: AS_OF,
        completedCredentialNames: completedCredentialNamesAsOf(input),
      };
      const previewMember: Member = {
        employeeId: 'synthetic-parity-member',
        firstName: 'Synthetic',
        lastName: 'Member',
        memberId: MEMBER_ID,
        rank: 'FF',
        rscSeniority: 1,
        rankSeniority: 1,
        isProbationary: false,
        credentials: projection.certifications.flatMap((credential) =>
          credential.credentialName === null
            ? []
            : [
                {
                  name: credential.credentialName,
                  status: credential.status,
                  effectiveOn: credential.effectiveOn,
                  expiresOn: credential.expiresOn,
                },
              ],
        ),
        scoringEvidence,
      };
      const frozenMember = eligibilityMemberFromFrozen({
        memberId: MEMBER_ID,
        pool: 'FF',
        rscSeniority: 1,
        rankSeniority: 1,
        rank: 'FF',
        isProbationary: false,
        credentialNames: activeCredentialNamesByMemberAsOf(input).get(MEMBER_ID) ?? [],
        scoringEvidence,
        exclusionReason: null,
        authoritativeAssignmentId: null,
      });
      const preview = evaluateEligibility(previewMember, rule);
      const frozen = evaluateEligibility(frozenMember, rule);
      expect(preview.eligible).toBe(eligible);
      expect(frozen.eligible).toBe(eligible);
      expect([preview.points, preview.soPoints, preview.moPoints]).toEqual([
        frozen.points,
        frozen.soPoints,
        frozen.moPoints,
      ]);
      if (eligible) {
        // Frozen evidence retains approved names rather than private interval
        // rows; its explanatory dates differ while the minimum decision agrees.
        expect(preview.reasons.map(({ code, satisfied }) => ({ code, satisfied }))).toEqual(
          frozen.reasons.map(({ code, satisfied }) => ({ code, satisfied })),
        );
      }
    }
  });
});
