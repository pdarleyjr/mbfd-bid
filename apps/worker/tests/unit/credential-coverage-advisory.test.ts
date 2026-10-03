import type { PositionRule } from '@mbfd/eligibility';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { initializeAnnualOperations } from '../../src/lib/annual-bid-operations.js';
import { unresolvedSpecialtyPriority } from '../../src/lib/canonical-specialty-priority.js';
import { projectFrozenCredentialCoverage } from '../../src/lib/credential-coverage-advisory.js';

function fixture() {
  const rules: PositionRule[] = [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `DE${i}`,
      credential: 'Driver Engineer Qualified',
    })),
    { id: 'AT810', credential: 'Air Tech 810' },
  ].map(({ id, credential }) => ({
    positionId: id,
    ruleBookVersion: 'synthetic',
    requiredCriteria: { rank: ['FF'], credentials: [credential], custom: [] },
    pointsPreference: { max: 0, items: [] },
    tieBreakChain: ['rsc_seniority'],
  }));
  const policy = {
    v: 1,
    policyRevision: 'synthetic',
    stages: [
      {
        id: 'ff',
        label: 'Firefighters',
        order: 0,
        memberIds: Array.from({ length: 12 }, (_, i) => i + 1),
        opportunityPositionIds: rules.map((rule) => rule.positionId),
        kind: 'FIREFIGHTER',
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [99],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };
  const snapshot = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: 'synthetic',
    ruleBookRevision: 1,
    positionTemplateVersion: 'synthetic',
    configurationRevision: 1,
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2030-01-01',
      livePolicy: policy,
    },
    credentialEvaluationOn: '2030-01-01',
    capturedAtMs: 1,
    members: Array.from({ length: 12 }, (_, i) => ({
      memberId: i + 1,
      pool: 'FF',
      rank: 'FF',
      rscSeniority: i + 1,
      rankSeniority: i + 1,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      isProbationary: false,
      credentialNames: [
        ...(i < 10 ? ['Driver Engineer Qualified'] : []),
        ...(i === 0 ? ['Air Tech 810'] : []),
      ],
    })),
    ruleBookMaterial: {
      v: 1,
      rules: rules.map((rule) => ({
        ruleBookVersion: 'synthetic',
        templateVersion: 'synthetic',
        positionId: rule.positionId,
        requiredCriteriaJson: JSON.stringify(rule.requiredCriteria),
        pointsPreferenceJson: JSON.stringify(rule.pointsPreference),
        tieBreakChainJson: JSON.stringify(rule.tieBreakChain),
      })),
      positions: rules.map((rule) => ({
        id: rule.positionId,
        templateVersion: 'synthetic',
        bidParticipation: 'BIDDABLE',
        isExcludedFromCount: false,
        shift: 'A',
        station: '1',
        unit: 'Synthetic',
        rankRequired: 'FF',
        positionName: rule.positionId,
      })),
    },
  });
  if (snapshot.v !== 3) throw new Error('Synthetic V3 required');
  return { snapshot, rules, state: emptyBidSessionState('synthetic-coverage') };
}

describe('frozen credential coverage advisories', () => {
  const available = (input: ReturnType<typeof fixture>) => {
    const result = projectFrozenCredentialCoverage(input);
    if (result.availability !== 'AVAILABLE') throw new Error(result.code);
    return result;
  };
  it('warns at ten qualified Driver Engineers for five open seats, including Air Tech independently', () => {
    const input = fixture();
    const result = available(input);
    expect(result.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Driver Engineer Qualified',
          remaining_seat_count: 5,
          eligible_member_count: 10,
          buffer: 5,
          status: 'LOW_BUFFER',
        }),
        expect.objectContaining({
          label: 'Air Tech 810',
          remaining_seat_count: 1,
          eligible_member_ids: [1],
          status: 'LOW_BUFFER',
          critical_member_ids: [1],
        }),
      ]),
    );
    expect(input.state.fills).toEqual({});
  });

  it('removes members awarded elsewhere and acting-duty members from the available cert pool', () => {
    const input = fixture();
    input.state.fills.ordinary = { memberId: 2, ordinal: 2, bidId: 'ordinary-2' };
    input.state.live = {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
      exceptionalAssignments: [
        {
          assignmentId: 'acting',
          commandId: 'acting-command',
          memberId: 1,
          roleLabel: 'Acting administrative role',
          positionId: null,
          actorMemberId: 99,
          reason: 'Chief direction',
          assignedAtMs: 1,
          releasedAtMs: null,
          releaseCommandId: null,
        },
      ],
    };
    const result = available(input);
    expect(result.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Driver Engineer Qualified',
          eligible_member_count: 8,
          status: 'LOW_BUFFER',
        }),
        expect.objectContaining({
          label: 'Air Tech 810',
          eligible_member_count: 0,
          status: 'SHORTAGE',
        }),
      ]),
    );
    expect(result.guaranteed_uncovered_seat_count).toBe(1);
  });

  it('detects overlapping qualification shortage even when per-cert raw counts look sufficient', () => {
    const input = fixture();
    input.snapshot.members = input.snapshot.members.map((member) => ({
      ...member,
      credentialNames:
        member.memberId <= 5
          ? ['Driver Engineer Qualified', ...(member.memberId === 1 ? ['Air Tech 810'] : [])]
          : [],
    }));
    const result = available(input);
    expect(
      result.groups.every((group) => group.eligible_member_count >= group.remaining_seat_count),
    ).toBe(true);
    expect(result.status).toBe('SHORTAGE');
    expect(result.guaranteed_uncovered_seat_count).toBe(1);
    expect(result.critical_member_ids).toContain(1);
  });

  it('stops warning for filled seats without changing the remaining frozen qualifications', () => {
    const input = fixture();
    input.state.fills.AT810 = {
      memberId: 1,
      ordinal: 1,
      bidId: 'at-1',
      forced: { commandId: 'force-at', actorMemberId: 99, reason: 'Chief-directed', atMs: 1 },
    };
    const result = available(input);
    expect(result.groups.find((group) => group.label === 'Air Tech 810')).toMatchObject({
      remaining_seat_count: 0,
      status: 'FEASIBLE',
    });
    expect(input.snapshot.members[0]?.credentialNames).toEqual([
      'Driver Engineer Qualified',
      'Air Tech 810',
    ]);
  });
  it('surfaces missing frozen evidence and inconsistent graphs as unavailable instead of throwing', () => {
    const missingDate = fixture();
    missingDate.snapshot.credentialEvaluationOn = undefined;
    expect(projectFrozenCredentialCoverage(missingDate)).toMatchObject({
      availability: 'UNAVAILABLE',
      code: 'CREDENTIAL_COVERAGE_EVIDENCE_DATE_MISSING',
    });
    const inconsistent = fixture();
    inconsistent.state.fills.invalid = {
      memberId: 999,
      ordinal: 1,
      bidId: 'invalid-frozen-member',
    };
    expect(projectFrozenCredentialCoverage(inconsistent)).toMatchObject({
      availability: 'UNAVAILABLE',
      code: 'CREDENTIAL_COVERAGE_EVALUATION_UNAVAILABLE',
    });
  });

  it('limits rank-specific specialty ordinal requirements to members eligible for the related seats', () => {
    const input = fixture();
    if (input.snapshot.settings.v !== 3) throw new Error('Synthetic V3 settings required');
    input.snapshot.members = input.snapshot.members.map((member) => ({
      ...member,
      specialtyQualifications: [],
      bidOrdinalEvidence: {
        datasetId: 'synthetic-ordinal-source',
        sourceSha256: 'a'.repeat(64),
        timeInGrade: member.memberId,
        departmentService: member.memberId,
      },
    }));
    const ordinary = input.snapshot.members[0];
    if (!ordinary) throw new Error('Synthetic member required');
    input.snapshot.members.push(
      {
        ...ordinary,
        memberId: 99,
        pool: 'EXCLUDED',
        exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
        bidOrdinalEvidence: undefined,
      },
      { ...ordinary, memberId: 98, pool: 'OFC', rank: 'LT', bidOrdinalEvidence: undefined },
    );
    input.snapshot.settings.livePolicy.annualOperations = {
      v: 1,
      stageOrder: ['ff'],
      requiredTopologyPositionIds: input.rules.map((rule) => rule.positionId),
      contact: {
        minimumAttempts: null,
        timingMode: 'OPERATOR_DISCRETION',
        durationSeconds: null,
        evidenceRequired: false,
      },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: null,
        max: null,
        captainDcMax: null,
      },
      specialties: [
        {
          id: 'rank-scoped-specialty',
          label: 'Rank-scoped specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: ['DE0', 'DE1'],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['POINTS', 'TIME_IN_GRADE_BID_ORDINAL'],
        },
      ],
    };
    expect(available(input).groups).toContainEqual(
      expect.objectContaining({
        label: 'Rank-scoped specialty',
        eligible_member_count: 10,
        eligible_member_ids: Array.from({ length: 10 }, (_, i) => i + 1),
      }),
    );
  });

  it('removes ended selection rights from cert coverage and specialty priority while retaining skips, deferrals and explicit returns', () => {
    const input = fixture();
    if (input.snapshot.settings.v !== 3) throw new Error('Synthetic V3 settings required');
    const policy = input.snapshot.settings.livePolicy;
    policy.dispositions = policy.dispositions.map((rule) => ({
      ...rule,
      terminal: rule.disposition === 'DECLINED',
      retainsLaterSelectionRights: !['DECLINED', 'PASS'].includes(rule.disposition),
    }));
    policy.annualOperations = {
      v: 1,
      stageOrder: ['ff'],
      requiredTopologyPositionIds: input.rules.map((rule) => rule.positionId),
      contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: { combatGroups: ['G1', 'G2', 'G3', 'G4'], min: null, max: null, captainDcMax: null },
      specialties: [
        {
          id: 'de-specialty',
          label: 'Driver Engineer specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: ['DE0'],
          requiredCredentialNames: ['Driver Engineer Qualified'],
          requiredSpecialtyCodes: [],
          points: [{ credentialName: 'Driver Engineer Qualified', value: 1 }],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
        },
      ],
    };
    input.snapshot.members = input.snapshot.members.map((member) => ({
      ...member,
      specialtyQualifications: [],
    }));
    const history = [
      [1, 'DECLINED'],
      [2, 'PASS'],
      [3, 'SKIP'],
      [4, 'DEFER'],
      [5, 'PASS'],
      [5, 'SKIP'],
    ] as const;
    input.state.live = {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: history.map(([memberId, disposition]) => ({
        memberId,
        disposition,
        stageId: 'ff',
        reason: 'Synthetic reviewed disposition',
        evidenceReference: null,
      })),
    };
    const priority = () => {
      const rule = input.rules[0];
      if (!rule) throw new Error('Synthetic DE rule required');
      return unresolvedSpecialtyPriority({
        snapshot: input.snapshot,
        state: input.state,
        memberId: 6,
        positionId: 'DE0',
        rule,
      });
    };
    expect(available(input).groups).toContainEqual(
      expect.objectContaining({
        label: 'Driver Engineer specialty',
        eligible_member_ids: [3, 4, 5, 6, 7, 8, 9, 10],
      }),
    );
    expect(available(input).groups).toContainEqual(
      expect.objectContaining({ label: 'Air Tech 810', eligible_member_count: 0 }),
    );
    expect(priority()).toEqual([{ specialtyId: 'de-specialty', candidateMemberIds: [3, 4, 5] }]);
    input.state.annual = {
      ...initializeAnnualOperations({ preferenceSheets: [] }),
      returningMemberId: 1,
    };
    expect(available(input).groups).toContainEqual(
      expect.objectContaining({ label: 'Air Tech 810', eligible_member_ids: [1] }),
    );
    expect(priority()).toEqual([{ specialtyId: 'de-specialty', candidateMemberIds: [1, 3, 4, 5] }]);
  });
});
