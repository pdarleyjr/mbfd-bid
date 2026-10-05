import { type PositionRule, evaluateEligibilityCohort } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { projectFrozenCredentialCoverage } from '../../src/lib/credential-coverage-advisory.js';
import { projectOperatorSpecialtyRoster } from '../../src/lib/operator-specialty-roster.js';

function fixture() {
  const base: PositionRule = {
    positionId: 'DE1',
    ruleBookVersion: 'synthetic',
    requiredCriteria: { rank: ['FF'], credentials: ['Driver Engineer Qualified'], custom: [] },
    pointsPreference: {
      max: 4,
      items: [{ credential: 'Preference', points: 4, requiresOpsPair: false }],
    },
    tieBreakChain: ['points', 'rsc_seniority'],
  };
  const rules = [
    base,
    { ...base, positionId: 'DE2' },
    {
      ...base,
      positionId: 'AT810',
      requiredCriteria: { ...base.requiredCriteria, credentials: ['Air Tech 810'] },
    },
    {
      ...base,
      positionId: 'MARINE',
      requiredCriteria: { ...base.requiredCriteria, credentials: ['Marine Minimum'] },
    },
    {
      ...base,
      positionId: 'INSPECTOR',
      requiredCriteria: { ...base.requiredCriteria, credentials: ['Inspector Minimum'] },
    },
    {
      ...base,
      positionId: 'CPT5',
      requiredCriteria: { rank: ['CPT'] as const, credentials: ['Rescue Minimum'], custom: [] },
    } as PositionRule,
    {
      ...base,
      positionId: 'REGULAR',
      requiredCriteria: { ...base.requiredCriteria, credentials: [] },
      pointsPreference: { max: 0, items: [] },
    },
  ];
  const members = [1, 2, 3, 4].map((memberId) => ({
    memberId,
    pool: 'FF',
    rank: 'FF',
    rscSeniority: memberId,
    rankSeniority: memberId,
    isProbationary: false,
    specialtyQualifications: [],
    credentialNames:
      memberId === 3
        ? ['Preference']
        : [
            'Driver Engineer Qualified',
            ...(memberId > 1 ? ['Preference'] : []),
            ...(memberId === 2 ? ['Air Tech 810', 'Marine Minimum', 'Inspector Minimum'] : []),
          ],
    exclusionReason: null,
    authoritativeAssignmentId: null,
  }));
  const snapshot = {
    v: 3,
    credentialEvaluationOn: '2030-01-01',
    members,
    settings: {
      v: 3,
      livePolicy: {
        dispositions: [],
        annualOperations: {
          specialties: [],
          membershipDistributions: [
            {
              id: 'trt',
              label: 'TRT',
              membershipSource: 'REVIEWED_QUALIFIED_POOL',
              memberIds: [2, 4],
            },
          ],
        },
      },
    },
    ruleBookMaterial: {
      positions: rules.map((rule) => ({
        id: rule.positionId,
        bidParticipation: 'BIDDABLE',
        unit: rule.positionId === 'MARINE' ? 'Fire Boat 6' : 'Synthetic',
        positionName: rule.positionId,
      })),
    },
  } as unknown as Extract<BidSessionPolicySnapshot, { v: 3 }>;
  const state = emptyBidSessionState('synthetic-specialty');
  state.lastSeq = 6;
  return { sessionId: state.bidSessionId, snapshot, rules, state };
}
function project(input: ReturnType<typeof fixture>) {
  return projectOperatorSpecialtyRoster({
    ...input,
    credentialCoverage: projectFrozenCredentialCoverage(input),
  });
}
describe('canonical operator specialty roster', () => {
  it('exposes every configured qualification profile and reviewed membership pool without including ordinary seats', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = project(input);
    expect(result.availability).toBe('AVAILABLE');
    expect(result.groups.map((group) => group.label)).toEqual(
      expect.arrayContaining([
        'Driver Engineer',
        'AT810',
        'Marine · MARINE',
        'INSPECTOR',
        'CPT5',
        'TRT membership',
      ]),
    );
    expect(result.groups.some((group) => group.positionIds.includes('REGULAR'))).toBe(false);
    expect(result.groups.find((group) => group.id === 'profile:DE1')).toMatchObject({
      positionIds: ['DE1', 'DE2'],
      candidates: [
        { memberId: 2, priority: 1, points: 4 },
        { memberId: 4, priority: 2, points: 4 },
        { memberId: 1, priority: 3, points: 0 },
      ],
      eligibleMemberCount: 3,
      remainingSeatCount: 2,
      status: 'LOW_BUFFER',
    });
    expect(result.groups.find((group) => group.id === 'membership:trt')).toMatchObject({
      rankingAvailable: false,
      status: null,
      remainingSeatCount: null,
      candidates: [
        { memberId: 2, priority: null, points: null },
        { memberId: 4, priority: null, points: null },
      ],
    });
    expect(JSON.stringify(input)).toBe(before);
  });
  it('retains qualified taken members for inspection but removes awards, acting duties and terminal dispositions from remaining capacity', () => {
    const input = fixture();
    input.state.fills.REGULAR = { memberId: 2, ordinal: 1, bidId: 'synthetic-taken' };
    input.state.live = {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
      exceptionalAssignments: [{ memberId: 4, releasedAtMs: null }],
    } as never;
    const result = project(input);
    expect(result.groups.find((group) => group.id === 'profile:DE1')).toMatchObject({
      candidates: [
        { memberId: 2, available: false },
        { memberId: 4, available: false },
        { memberId: 1, available: true },
      ],
      eligibleMemberCount: 1,
      status: 'SHORTAGE',
    });
    expect(result.groups.find((group) => group.id === 'profile:AT810')).toMatchObject({
      eligibleMemberCount: 0,
      status: 'SHORTAGE',
    });
    expect(input.state.fills.REGULAR.bidId).toBe('synthetic-taken');
  });
  it('reuses source-authoritative ranking without granting missing qualifications from points', () => {
    const input = fixture();
    for (const member of input.snapshot.members) {
      member.scoreReferenceEvidence = [
        {
          v: 1,
          listId: 'synthetic-driver-list',
          positionIds: ['DE1', 'DE2'],
          points: 10 - member.memberId,
          soPoints: 0,
          moPoints: 0,
          sourceName: 'Synthetic published list',
          sourceSha256: 'a'.repeat(64),
          sourceLocation: { page: 1, textLine: member.memberId },
          literalTotal: 10 - member.memberId,
          printedBidOrder: 5 - member.memberId,
          sourcePriority: 5 - member.memberId,
        },
      ];
    }
    const result = project(input);
    const group = result.groups.find((group) => group.id === 'profile:DE1');
    const rule = input.rules[0];
    if (!rule) throw new Error('Synthetic rule missing');
    const canonical = evaluateEligibilityCohort({
      asOf: '2030-01-01',
      rule,
      members: input.snapshot.members.map((member) => ({
        memberId: member.memberId,
        employeeId: String(member.memberId),
        firstName: '',
        lastName: '',
        rank: 'FF',
        rscSeniority: member.rscSeniority,
        rankSeniority: member.rankSeniority ?? undefined,
        isProbationary: false,
        credentials: member.credentialNames.map((name) => ({ name })),
        scoreReferenceEvidence: member.scoreReferenceEvidence,
      })),
    });
    expect(group?.candidates.map((candidate) => candidate.memberId)).toEqual(
      canonical.eligible.map((candidate) => candidate.member.memberId),
    );
    expect(group?.candidates.map((candidate) => candidate.memberId)).toEqual([4, 2, 1]);
    expect(group?.candidates.some((candidate) => candidate.memberId === 3)).toBe(false);
  });
  it('uses annual specialty qualification and ranking instead of treating a position minimum as the whole specialty policy', () => {
    const input = fixture();
    if (input.snapshot.settings.v !== 3) throw new Error('V3 required');
    const annual = input.snapshot.settings.livePolicy.annualOperations;
    if (!annual) throw new Error('Synthetic annual operations required');
    annual.specialties = [
      {
        id: 'special',
        label: 'Special Operations',
        mode: 'INTERRUPTING',
        opportunityPositionIds: ['DE1', 'DE2'],
        requiredCredentialNames: ['Preference'],
        requiredSpecialtyCodes: [],
        points: [{ credentialName: 'Preference', value: 4 }],
        tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
      },
    ];
    expect(project(input).groups.find((group) => group.id === 'specialty:special')).toMatchObject({
      label: 'Special Operations',
      candidates: [{ memberId: 2 }, { memberId: 4 }],
    });
  });
  it('splits identical rule profiles when their exact published source priorities differ', () => {
    const input = fixture();
    for (const member of input.snapshot.members) {
      member.scoreReferenceEvidence = ['DE1', 'DE2'].map((positionId) => ({
        v: 1,
        listId: `synthetic-${positionId}`,
        positionIds: [positionId],
        points: 0,
        soPoints: 0,
        moPoints: 0,
        sourceName: `Synthetic ${positionId} published order`,
        sourceSha256: (positionId === 'DE1' ? 'a' : 'b').repeat(64),
        sourceLocation: { page: 1, textLine: member.memberId },
        literalTotal: 0,
        printedBidOrder: null,
        sourcePriority: positionId === 'DE1' ? member.memberId : 5 - member.memberId,
      }));
    }
    const result = project(input);
    const first = result.groups.find((group) => group.id === 'profile:DE1');
    const second = result.groups.find((group) => group.id === 'profile:DE2');
    expect(first).toMatchObject({
      label: 'Driver Engineer · DE1',
      positionIds: ['DE1'],
      rankingAvailable: true,
    });
    expect(second).toMatchObject({
      label: 'Driver Engineer · DE2',
      positionIds: ['DE2'],
      rankingAvailable: true,
    });
    expect(first?.candidates.map((candidate) => candidate.memberId)).toEqual([1, 2, 4]);
    expect(second?.candidates.map((candidate) => candidate.memberId)).toEqual([4, 2, 1]);
    expect(
      second?.candidates.every((candidate) => candidate.eligiblePositionIds.join() === 'DE2'),
    ).toBe(true);
  });
  it('keeps unresolved order separate from eligibility and fails missing frozen dates closed without mutating the session', () => {
    const input = fixture();
    const fourth = input.snapshot.members[3];
    if (!fourth) throw new Error('Synthetic member required');
    fourth.rscSeniority = 2;
    expect(project(input).groups.find((group) => group.id === 'profile:DE1')).toMatchObject({
      rankingAvailable: false,
      dataBlockedMemberIds: [2, 4],
      rankingCode: 'SPECIALTY_ROSTER_ORDER_EVIDENCE_INCOMPLETE',
    });
    input.snapshot.credentialEvaluationOn = undefined;
    expect(project(input)).toMatchObject({
      availability: 'UNAVAILABLE',
      groups: [],
      code: 'SPECIALTY_ROSTER_EVIDENCE_DATE_MISSING',
    });
    expect(input.state.lastSeq).toBe(6);
  });
});
