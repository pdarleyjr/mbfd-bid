import { describe, expect, it } from 'vitest';

import {
  BidConfigurationSettingsSchema,
  BidDefinitionContentSchema,
  BidSessionPolicySnapshotSchema,
  FrozenAnnualOperationsPolicySchema,
  FrozenLiveBidPolicySchema,
  LiveBidCommandSchema,
  StageParticipantSourceDefinitionsSchema,
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
  'create_live_session',
  'approve_transition',
  'approve_final_results',
  'publish',
] as const;
const dispositions = ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const;

describe('live command policy contracts', () => {
  const base = {
    v: 1,
    commandId: '00000000-0000-4000-8000-000000000001',
    bidSessionId: 'session-1',
    expectedSeq: 1,
    actor: { id: 99, role: 'admin' },
    reason: 'Chief-approved correction',
    evidenceReference: null,
  } as const;

  it('accepts only the same-member opportunity amendment contract', () => {
    expect(
      LiveBidCommandSchema.safeParse({
        ...base,
        type: 'live.amend_selection',
        memberId: 1,
        fromPositionId: 'p1',
        toPositionId: 'p2',
      }).success,
    ).toBe(true);
    expect(
      LiveBidCommandSchema.safeParse({
        ...base,
        type: 'live.amend_selection',
        positionId: 'p1',
        replacementMemberId: 2,
      }).success,
    ).toBe(false);
  });

  it('accepts an explicit remaining-member order command', () => {
    expect(
      LiveBidCommandSchema.safeParse({
        ...base,
        type: 'live.alter_order',
        orderedRemainingMemberIds: [2, 1],
      }).success,
    ).toBe(true);
  });
});

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
  it('retains unresolved source procedures only in pending authoring and never accepts them as frozen execution', () => {
    const pending = {
      ...completeLivePolicy,
      stages: completeLivePolicy.stages.map((stage) => ({ ...stage, memberIds: [] })),
      actionPermissions: completeLivePolicy.actionPermissions.map((grant) => ({
        ...grant,
        actorMemberIds: [],
      })),
    };
    const definition = {
      v: 1,
      bidYear: 2027,
      settings: null,
      notes: { bid: null, positions: null },
      policy: null,
      pendingPolicy: {
        policyText: 'Synthetic source with unresolved operators',
        executionPolicy: pending,
      },
      planning: null,
      authoring: null,
      positions: [],
      rules: [],
      participation: [],
      staffingBindings: [],
      sourceDecisions: [],
    };
    expect(BidDefinitionContentSchema.safeParse(definition).success).toBe(true);
    expect(FrozenLiveBidPolicySchema.safeParse(pending).success).toBe(false);
    expect(
      BidDefinitionContentSchema.safeParse({
        ...definition,
        pendingPolicy: undefined,
        policy: definition.pendingPolicy,
      }).success,
    ).toBe(false);
    expect(
      BidDefinitionContentSchema.safeParse({
        ...definition,
        pendingPolicy: {
          ...definition.pendingPolicy,
          executionPolicy: { ...pending, stages: [...pending.stages, pending.stages[0]] },
        },
      }).success,
    ).toBe(false);
  });
  it('keeps explicit-stage definitions readable while admitting typed participant sources', () => {
    const legacyDefinition = {
      v: 1,
      bidYear: 2027,
      settings: null,
      notes: { bid: null, positions: null },
      policy: {
        policyText: 'Synthetic stage source policy.',
        executionPolicy: completeLivePolicy,
      },
      planning: null,
      authoring: null,
      positions: [],
      rules: [],
      participation: [],
      staffingBindings: [],
      sourceDecisions: [],
    };
    expect(BidDefinitionContentSchema.safeParse(legacyDefinition).success).toBe(true);

    const stageParticipantSources = StageParticipantSourceDefinitionsSchema.parse([
      {
        stageId: 'D-CPT',
        sourceRef: 'synthetic-policy:captain-stage',
        participantSource: {
          type: 'FILTER',
          active: true,
          bidParticipation: 'BIDDABLE',
          ranks: ['CPT'],
        },
        ordering: [
          { key: 'RANK_SENIORITY', direction: 'ASC' },
          { key: 'RSC_SENIORITY', direction: 'ASC' },
        ],
      },
      {
        stageId: 'D-LT',
        sourceRef: 'synthetic-policy:lieutenant-stage',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [12] },
        ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
      },
    ]);
    const adaptiveDefinition = BidDefinitionContentSchema.parse({
      ...legacyDefinition,
      policy: { ...legacyDefinition.policy, stageParticipantSources },
    });
    expect(adaptiveDefinition.policy?.stageParticipantSources).toEqual(stageParticipantSources);
    const comparator = [
      { key: 'RANK_SENIORITY', direction: 'ASC' },
      { key: 'RSC_SENIORITY', direction: 'ASC' },
    ];
    const orderingDecision = {
      issueId: 'synthetic-governing-ordering-decision',
      title: 'Synthetic annual ordering authority',
      question: 'Which comparator controls the synthetic annual Bid order?',
      area: 'annual-policy' as const,
      status: 'RESOLVED' as const,
      decision: 'Use the reviewed synthetic rank-seniority comparator.',
      sourceRef: 'Synthetic annual-policy source evidence.',
      effectiveOn: '2027-01-01',
      resolution: { v: 1 as const, kind: 'BID_ORDERING_COMPARATOR' as const, comparator },
    };
    const authorityDefinition = BidDefinitionContentSchema.parse({
      ...legacyDefinition,
      policy: {
        ...legacyDefinition.policy,
        orderingAuthority: {
          v: 1,
          sourceDecisionId: orderingDecision.issueId,
          comparator,
        },
      },
      sourceDecisions: [orderingDecision],
    });
    expect(authorityDefinition.policy?.orderingAuthority).toEqual({
      v: 1,
      sourceDecisionId: orderingDecision.issueId,
      comparator,
    });
    expect(
      StageParticipantSourceDefinitionsSchema.safeParse([
        {
          ...stageParticipantSources[0],
          participantSource: {
            type: 'FILTER',
            active: false,
            bidParticipation: 'BIDDABLE',
            ranks: ['CPT'],
          },
        },
      ]).success,
    ).toBe(false);
    expect(
      StageParticipantSourceDefinitionsSchema.safeParse([
        {
          ...stageParticipantSources[0],
          participantSource: {
            type: 'FILTER',
            active: true,
            bidParticipation: 'BIDDABLE',
            ranks: ['CPT'],
            includeMemberIds: [11],
            excludeMemberIds: [12],
          },
        },
      ]).success,
    ).toBe(true);
    expect(
      StageParticipantSourceDefinitionsSchema.safeParse([
        {
          ...stageParticipantSources[0],
          participantSource: {
            type: 'FILTER',
            active: true,
            bidParticipation: 'BIDDABLE',
            ranks: ['CPT'],
            includeMemberIds: [11],
            excludeMemberIds: [11],
          },
        },
      ]).success,
    ).toBe(false);
    expect(
      BidDefinitionContentSchema.safeParse({
        ...authorityDefinition,
        policy: {
          ...authorityDefinition.policy,
          orderingAuthority: {
            v: 1,
            sourceDecisionId: orderingDecision.issueId,
            comparator: [
              { key: 'RANK_SENIORITY', direction: 'ASC' },
              { key: 'RANK_SENIORITY', direction: 'DESC' },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });

  it('does not silently invent annual contact timing or A-Day limits', () => {
    expect(
      FrozenAnnualOperationsPolicySchema.safeParse({
        v: 1,
        stageOrder: [
          'D_CAPTAIN',
          'D_LIEUTENANT',
          'ABC_CAPTAIN',
          'ABC_LIEUTENANT',
          'ABC_FIREFIGHTER',
        ],
        contact: { minimumAttempts: 3, timingMode: 'HARD_MINIMUM', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 18,
          max: 19,
          captainDcMax: 2,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
        },
      }).success,
    ).toBe(false);
  });
  it('requires an explicit, complete policy before a live action is authorized', () => {
    const policy = FrozenLiveBidPolicySchema.parse(completeLivePolicy);
    expect(isLiveBidActionAuthorized(policy, 'record_selection', 101)).toBe(true);
    expect(isLiveBidActionAuthorized(policy, 'create_live_session', 101)).toBe(true);
    expect(isLiveBidActionAuthorized(policy, 'record_selection', 999)).toBe(false);
    expect(isLiveBidActionAuthorized(undefined, 'record_selection', 101)).toBe(false);
    expect(isLiveBidActionAuthorized(policy, 'publish', null)).toBe(false);
  });

  it('keeps historical eleven-action policies readable while denying the later create-session action', () => {
    const historicalPolicy = FrozenLiveBidPolicySchema.parse({
      ...completeLivePolicy,
      actionPermissions: completeLivePolicy.actionPermissions.filter(
        (grant) => grant.action !== 'create_live_session',
      ),
    });
    expect(isLiveBidActionAuthorized(historicalPolicy, 'record_selection', 101)).toBe(true);
    expect(isLiveBidActionAuthorized(historicalPolicy, 'create_live_session', 101)).toBe(false);
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
        actionPermissions: completeLivePolicy.actionPermissions.filter(
          (grant) => grant.action !== 'publish',
        ),
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

  it('rejects a stage provenance ordering that disagrees with its frozen governing comparator', () => {
    const orderingAuthority = {
      v: 1,
      comparator: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
      sourceDecision: {
        issueId: 'synthetic-governing-ordering-decision',
        effectiveOn: '2027-01-01',
      },
    };
    expect(
      FrozenLiveBidPolicySchema.safeParse({
        ...completeLivePolicy,
        orderingAuthority,
        stages: [
          {
            ...completeLivePolicy.stages[0],
            participantProvenance: {
              v: 1,
              stageId: 'D-CPT',
              sourceRef: 'Synthetic captain stage source.',
              participantSource: {
                type: 'EXPLICIT_MEMBERS',
                memberIds: [11],
              },
              ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
              orderingAuthority,
              pinnedEvaluationCapturedAtMs: 1,
              resolvedMemberIds: [11],
            },
          },
          completeLivePolicy.stages[1],
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

  it('retains civilian personnel only as explicitly excluded non-bidders', () => {
    const civilian = {
      ...completeV3Snapshot,
      members: [
        {
          ...completeV3Snapshot.members[0],
          rank: 'CIVILIAN',
          pool: 'EXCLUDED',
          exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
        },
      ],
    };
    expect(BidSessionPolicySnapshotSchema.safeParse(civilian).success).toBe(true);
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...civilian,
        members: [{ ...civilian.members[0], pool: 'FF', exclusionReason: null }],
      }).success,
    ).toBe(false);
  });

  it('binds annual policy evidence to the snapshot rule book', () => {
    const evidence = {
      documentId: 'annual-policy-document-1',
      documentRevision: 3,
      ruleBookVersion: '2027.2',
      executablePolicyRevision: '2027.2-policy-r3',
      policyText: 'Approved annual policy language retained with the immutable session.',
    };
    expect(
      BidSessionPolicySnapshotSchema.parse({
        ...completeV3Snapshot,
        annualPolicyEvidence: evidence,
      }),
    ).toMatchObject({ annualPolicyEvidence: { documentRevision: 3 } });
    expect(
      BidSessionPolicySnapshotSchema.safeParse({
        ...completeV3Snapshot,
        annualPolicyEvidence: { ...evidence, ruleBookVersion: '2027.99' },
      }).success,
    ).toBe(false);
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
