import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  BidDispositionSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { carryForwardBidDefinitionStructure } from '../../src/lib/bid-definition-carry-forward.js';

function source(): BidDefinitionContent {
  const execution = FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-source-policy',
    stages: [
      {
        id: 'ff',
        label: 'Firefighter',
        order: 0,
        memberIds: [41],
        opportunityPositionIds: ['synthetic-seat'],
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
      actorMemberIds: [41],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: 'Synthetic A-Day authority',
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['ff'],
      requiredTopologyPositionIds: ['synthetic-seat'],
      membershipDistributions: [
        {
          id: 'synthetic-membership',
          label: 'Synthetic reviewed membership',
          sourceRef: 'Synthetic source decision',
          sourceDecisionId: 'synthetic-source',
          membershipSource: 'REVIEWED_EXISTING_MEMBERS',
          memberIds: [41],
          shifts: ['A'],
          minimumPerShift: 0,
          maximumPerShift: 1,
          maximumPerADay: 1,
        },
      ],
      contact: {
        minimumAttempts: 3,
        timingMode: 'OPERATOR_DISCRETION',
        durationSeconds: null,
        evidenceRequired: true,
      },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 20,
        captainDcMax: 2,
        specialtyMaximums: { MARINE_ASSIGNED: 2, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing: 'SIMULTANEOUS',
          sourceRef: 'Synthetic A-Day policy',
          officersPerGroup: null,
          timingExceptions: [
            {
              id: 'specialized',
              label: 'Synthetic specialized opportunity',
              timing: 'AFTER_POSITION_SELECTION',
              sourceRef: 'Synthetic specialized timeline',
              positionIds: ['synthetic-seat'],
              profileIds: [],
            },
          ],
          constraints: [
            {
              id: 'member-and-rank',
              label: 'Synthetic preserved rank constraint',
              sourceRef: 'Synthetic constraint source',
              maximum: 1,
              shifts: ['A'],
              positionIds: [],
              memberIds: [41],
              ranks: ['FF'],
            },
            {
              id: 'member-only',
              label: 'Synthetic member-only constraint',
              sourceRef: 'Synthetic constraint source',
              maximum: 1,
              shifts: ['A'],
              positionIds: [],
              memberIds: [41],
              ranks: [],
            },
          ],
        },
      },
    },
  });
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: 2026,
    settings: {
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-10-05',
      personnelEvaluationOn: '2026-10-05',
      livePolicy: execution,
    },
    notes: { bid: 'Synthetic Bid notes', positions: 'Synthetic opportunity notes' },
    policy: { policyText: 'Synthetic policy language', executionPolicy: execution },
    planning: { effectiveOn: '2026-10-05', sourceSessionId: null, sourcePolicyText: null },
    authoring: null,
    positions: [
      {
        id: 'synthetic-seat',
        shift: 'A',
        station: '7',
        division: 'Combat',
        unit: 'Synthetic Engine',
        rankRequired: 'FF',
        positionName: 'Synthetic firefighter',
        isFloating: false,
        isVacantByDesign: false,
        isExcludedFromCount: false,
      },
    ],
    rules: [
      {
        positionId: 'synthetic-seat',
        requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
        pointsPreferenceJson: '{"max":0,"items":[]}',
        tieBreakChainJson: '["rsc_seniority"]',
        notes: null,
      },
    ],
    participation: [
      {
        positionId: 'synthetic-seat',
        bidParticipation: 'BIDDABLE',
        authoritativeSourceRef: 'Synthetic policy source',
      },
    ],
    staffingBindings: [],
    sourceDecisions: [],
  });
}

describe('saved Bid structure carry-forward', () => {
  it('preserves reusable structure while clearing all annual identities and authority', () => {
    const result = carryForwardBidDefinitionStructure({
      source: source(),
      sourceVersionId: '01SYNTHETICCARRYFORWARDVERSION',
      targetYear: 2027,
      personnelEvaluationOn: '2027-10-05',
      credentialEvaluationOn: '2027-10-05',
      expectedDurationDays: 3,
      turnTimerSeconds: 180,
    });
    expect(BidDefinitionContentSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      bidYear: 2027,
      settings: {
        v: 2,
        personnelEvaluationOn: '2027-10-05',
        credentialEvaluationOn: '2027-10-05',
      },
      policy: null,
      pendingPolicy: {
        executionPolicy: {
          stages: [{ id: 'ff', memberIds: [] }],
          actionPermissions: expect.arrayContaining([
            expect.objectContaining({ action: 'record_selection', actorMemberIds: [] }),
          ]),
          annualOperations: {
            aDay: {
              execution: {
                timingExceptions: [expect.objectContaining({ id: 'specialized' })],
                constraints: [
                  expect.objectContaining({ id: 'member-and-rank', memberIds: [], ranks: ['FF'] }),
                ],
              },
            },
          },
        },
      },
      sourceDecisions: [
        expect.objectContaining({
          status: 'OPEN',
          blockingClassification: 'BLOCKS_FINAL_2026_CONFIGURATION',
        }),
      ],
    });
    expect(
      result.pendingPolicy?.executionPolicy.annualOperations?.aDay.execution?.constraints,
    ).toHaveLength(1);
    expect(result.pendingPolicy?.executionPolicy.annualOperations).not.toHaveProperty(
      'membershipDistributions',
    );
    expect(result.planning?.sourceSessionId).toBeNull();
  });
});
