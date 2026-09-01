import { describe, expect, it } from 'vitest';

import {
  BidConfigurationSettingsSchema,
  BidSessionPolicySnapshotSchema,
  FrozenLiveBidPolicySchema,
  isLiveBidActionAuthorized,
} from '../../src/index.js';

const liveActions = [
  'record_selection',
  'amend_selection',
  'skip_defer',
  'mark_unreachable',
  'force',
  'resolve_tie',
  'alter_order',
  'pause_resume',
  'approve_transition',
  'approve_final_results',
  'publish',
] as const;
const dispositions = ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const;

const completeLivePolicy = {
  v: 1,
  policyRevision: '2026.pending-approval',
  stages: [
    {
      id: 'D-CPT',
      label: 'D Captains',
      order: 1,
      memberIds: [11],
      opportunityPositionIds: ['D101'],
      kind: 'D_SHIFT',
    },
    {
      id: 'D-LT',
      label: 'D Lieutenants',
      order: 2,
      memberIds: [12],
      opportunityPositionIds: ['D102'],
      kind: 'D_SHIFT',
    },
  ],
  dispositions: dispositions.map((disposition) => ({
    disposition,
    advances: disposition !== 'HOLD',
    returns: disposition === 'DEFER',
    returnStageId: disposition === 'DEFER' ? 'D-LT' : null,
    retainsLaterSelectionRights: disposition === 'DEFER',
    terminal: disposition === 'DECLINED',
    requiresReason: true,
    requiresEvidence: disposition === 'UNREACHABLE',
    contactPolicyReference: disposition === 'UNREACHABLE' ? 'contact-2026' : null,
  })),
  actionPermissions: liveActions.map((action) => ({ action, actorMemberIds: [101] })),
  specialtyCatalogReference: null,
  aDayPolicyReference: null,
  transitionPolicyReference: null,
  publicationPolicyReference: null,
};

const legacySnapshot = {
  v: 1,
  ruleBookVersion: '2027.2',
  positionTemplateVersion: '2027.1',
  capturedAtMs: 1,
  members: [],
};

const completeV3Snapshot = {
  v: 3,
  ruleBookVersion: '2027.2',
  ruleBookRevision: 4,
  positionTemplateVersion: '2027.1',
  configurationRevision: 2,
  settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
  capturedAtMs: 1,
  members: [
    {
      memberId: 1,
      pool: 'FF',
      rscSeniority: 1,
      rankSeniority: 1,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      rank: 'FF',
      isProbationary: false,
      credentialNames: ['EMT'],
    },
  ],
  ruleBookMaterial: {
    v: 1,
    rules: [
      {
        ruleBookVersion: '2027.2',
        positionId: 'position-001',
        templateVersion: '2027.1',
        requiredCriteriaJson: '[]',
        pointsPreferenceJson: '[]',
        tieBreakChainJson: '[]',
      },
    ],
    positions: [
      {
        id: 'position-001',
        templateVersion: '2027.1',
        bidParticipation: 'BIDDABLE',
        isExcludedFromCount: false,
        shift: 'A',
        station: '1',
        unit: 'Engine 1',
        rankRequired: 'FF',
        positionName: 'Synthetic Firefighter',
      },
    ],
  },
};

describe('Bid configuration and session policy contracts', () => {
  it('requires an explicit, complete policy before a live action is authorized', () => {
    const policy = FrozenLiveBidPolicySchema.parse(completeLivePolicy);
    expect(isLiveBidActionAuthorized(policy, 'record_selection', 101)).toBe(true);
    expect(isLiveBidActionAuthorized(policy, 'record_selection', 999)).toBe(false);
    expect(isLiveBidActionAuthorized(undefined, 'record_selection', 101)).toBe(false);
    expect(isLiveBidActionAuthorized(policy, 'publish', null)).toBe(false);
  });

  it('rejects partial policy grants and ambiguous stage membership', () => {
    expect(
      FrozenLiveBidPolicySchema.safeParse({
        ...completeLivePolicy,
        actionPermissions: completeLivePolicy.actionPermissions.slice(1),
      }).success,
    ).toBe(false);
    expect(
      FrozenLiveBidPolicySchema.safeParse({
        ...completeLivePolicy,
        stages: [
          ...completeLivePolicy.stages,
          { ...completeLivePolicy.stages[1], id: 'FF', memberIds: [11], order: 3 },
        ],
      }).success,
    ).toBe(false);
  });

  it('continues to read immutable V1 recovery snapshots', () => {
    expect(BidSessionPolicySnapshotSchema.parse(legacySnapshot)).toMatchObject({ v: 1 });
  });

  it('requires a versioned settings and rule-book revision in every fresh V2 snapshot', () => {
    expect(
      BidSessionPolicySnapshotSchema.parse({
        ...legacySnapshot,
        v: 2,
        ruleBookRevision: 4,
        configurationRevision: 2,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
      }),
    ).toMatchObject({
      v: 2,
      ruleBookRevision: 4,
      configurationRevision: 2,
    });
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...legacySnapshot,
        v: 2,
        configurationRevision: 2,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
      }).success,
    ).toBe(false);
  });

  it('accepts a complete, immutable V3 material snapshot', () => {
    expect(BidSessionPolicySnapshotSchema.parse(completeV3Snapshot)).toMatchObject({
      v: 3,
      ruleBookRevision: 4,
      configurationRevision: 2,
      ruleBookMaterial: {
        rules: [{ positionId: 'position-001' }],
        positions: [{ id: 'position-001', bidParticipation: 'BIDDABLE' }],
      },
    });
  });

  it('keeps legacy V3 specialty evidence absent-but-distinguishable and validates new frozen specialty facts', () => {
    const legacyV3 = BidSessionPolicySnapshotSchema.parse(completeV3Snapshot);
    if (legacyV3.v !== 3) throw new Error('expected V3 test fixture');
    expect(legacyV3.members[0]).not.toHaveProperty('specialtyQualifications');

    const withSpecialtyFacts = {
      ...completeV3Snapshot,
      members: [
        {
          ...completeV3Snapshot.members[0],
          specialtyQualifications: [
            {
              specialtyCode: 'SYNTHETIC_MARINE',
              status: 'active',
              effectiveOn: '2027-01-15',
              expiresOn: null,
            },
            {
              specialtyCode: 'SYNTHETIC_RESCUE',
              status: 'revoked',
              effectiveOn: '2027-01-10',
              expiresOn: null,
            },
          ],
        },
      ],
    };
    expect(BidSessionPolicySnapshotSchema.parse(withSpecialtyFacts)).toMatchObject({
      v: 3,
      members: [
        {
          specialtyQualifications: [
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_MARINE', status: 'active' }),
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_RESCUE', status: 'revoked' }),
          ],
        },
      ],
    });
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...withSpecialtyFacts,
        members: [
          {
            ...withSpecialtyFacts.members[0],
            specialtyQualifications: [
              ...withSpecialtyFacts.members[0].specialtyQualifications,
              {
                specialtyCode: 'SYNTHETIC_MARINE',
                status: 'expired',
                effectiveOn: '2027-01-16',
                expiresOn: '2027-01-16',
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...withSpecialtyFacts,
        members: [
          {
            ...withSpecialtyFacts.members[0],
            specialtyQualifications: [
              {
                specialtyCode: 'SYNTHETIC_INVALID',
                status: 'expired',
                effectiveOn: '2027-01-16',
                expiresOn: null,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects missing, corrupt, and duplicate V3 material', () => {
    const duplicateRule = completeV3Snapshot.ruleBookMaterial.rules[0];
    const duplicatePosition = completeV3Snapshot.ruleBookMaterial.positions[0];

    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...completeV3Snapshot,
        ruleBookMaterial: undefined,
      }).success,
    ).toBe(false);
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...completeV3Snapshot,
        ruleBookMaterial: {
          ...completeV3Snapshot.ruleBookMaterial,
          rules: [{ ...duplicateRule, ruleBookVersion: '2027.3' }],
        },
      }).success,
    ).toBe(false);
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...completeV3Snapshot,
        ruleBookMaterial: {
          ...completeV3Snapshot.ruleBookMaterial,
          positions: [duplicatePosition, { ...duplicatePosition }],
        },
      }).success,
    ).toBe(false);
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...completeV3Snapshot,
        ruleBookMaterial: {
          ...completeV3Snapshot.ruleBookMaterial,
          rules: [duplicateRule, { ...duplicateRule }],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported configuration timer settings', () => {
    expect(
      BidConfigurationSettingsSchema.safeParse({
        v: 1,
        expectedDurationDays: 0,
        turnTimerSeconds: 10,
      }).success,
    ).toBe(false);
  });

  it('keeps V1 configuration readable as legacy but requires an explicit credential evaluation date in V2', () => {
    expect(
      BidConfigurationSettingsSchema.parse({
        v: 1,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
      }),
    ).toMatchObject({ v: 1 });
    expect(
      BidConfigurationSettingsSchema.parse({
        v: 2,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-15',
      }),
    ).toMatchObject({ v: 2, credentialEvaluationOn: '2027-01-15' });
    expect(
      BidConfigurationSettingsSchema.safeParse({
        v: 2,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
      }).success,
    ).toBe(false);
    expect(
      BidConfigurationSettingsSchema.safeParse({
        v: 2,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-02-30',
      }).success,
    ).toBe(false);
  });

  it('requires a V3 snapshot that uses V2 settings to retain the configured credential evaluation date', () => {
    const configured = {
      ...completeV3Snapshot,
      settings: {
        v: 2 as const,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-15',
      },
      credentialEvaluationOn: '2027-01-15',
    };
    expect(BidSessionPolicySnapshotSchema.parse(configured)).toMatchObject({
      v: 3,
      credentialEvaluationOn: '2027-01-15',
    });
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...configured,
        credentialEvaluationOn: undefined,
      }).success,
    ).toBe(false);
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...configured,
        credentialEvaluationOn: '2027-01-16',
      }).success,
    ).toBe(false);
  });
});
