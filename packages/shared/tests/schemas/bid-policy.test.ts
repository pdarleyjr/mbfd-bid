import { describe, expect, it } from 'vitest';

import { BidConfigurationSettingsSchema, BidSessionPolicySnapshotSchema } from '../../src/index.js';

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
});
