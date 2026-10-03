import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  BidDispositionSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { buildCorrected2026DraftRules } from '../../../src/lib/corrected-2026-draft-rules.js';
import {
  CORRECTED_2026_TOPOLOGY_SOURCE_DECISION,
  buildCorrected2026Topology,
} from '../../../src/lib/corrected-2026-topology.js';

/** Real reviewed topology/rule builders with synthetic actor/stage members;
 * no real personnel, source packet, production session or credentials held. */
export function stationTwoSourceDefinition(): BidDefinitionContent {
  const source = buildCorrected2026Topology();
  const rules = buildCorrected2026DraftRules({ approvedBidStartOn: '2026-10-24' }).rules;
  const stages = [
    { id: 'captains', rank: 'CPT' },
    { id: 'lieutenants', rank: 'LT' },
    { id: 'firefighters', rank: 'FF' },
  ].map((entry, order) => ({
    id: entry.id,
    label: entry.id,
    order,
    kind: 'MIXED',
    memberIds: [91000 + order],
    opportunityPositionIds: source
      .filter(
        (position) =>
          position.rankRequired === entry.rank &&
          !position.id.startsWith('D') &&
          rules.some((rule) => rule.positionId === position.id),
      )
      .map((position) => position.id),
  }));
  const policy = {
    v: 1,
    policyRevision: 'synthetic-actor-reviewed-source',
    stages,
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: true,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [91999],
    })),
    specialtyCatalogReference: 'Final July 2026 Bid Policy',
    aDayPolicyReference: 'Final July 2026 Bid Policy Procedure 14',
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: stages.map((stage) => stage.id),
      requiredTopologyPositionIds: rules.map((rule) => rule.positionId),
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      specialties: [
        {
          id: 'investigator-preference',
          label: 'Fire Investigator preference',
          mode: 'INTERRUPTING',
          opportunityPositionIds: ['A305', 'B305', 'C305'],
          requiredCredentialNames: ['Firesafety Inspector I'],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['POINTS', 'DEPARTMENT_SERVICE_BID_ORDINAL'],
        },
      ],
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 1,
        max: 20,
        captainDcMax: 2,
        specialtyMaximums: { MARINE_ASSIGNED: 2, MARINE_FLOAT: 1, DE: 2, SWAT: 2 },
        execution: {
          timing: 'SIMULTANEOUS',
          officersPerGroup: null,
          sourceRef: 'Existing reviewed ordinary A-Day authority',
          timingExceptions: [
            {
              id: 'existing-investigator-timing',
              label: 'Investigator ordinary A-Day',
              timing: 'AFTER_POSITION_SELECTION',
              sourceRef: 'Existing reviewed Investigator timing authority',
              positionIds: ['A305', 'B305', 'C305'],
              profileIds: [],
            },
          ],
          constraints: [
            {
              id: 'existing-de-limit',
              label: 'Designated DE limit',
              maximum: 2,
              sourceRef: 'Existing reviewed designated DE maximum',
              memberIds: [],
              positionIds: ['A103', 'B103', 'C103'],
              ranks: [],
              shifts: ['A', 'B', 'C'],
            },
          ],
        },
      },
    },
  };
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: 2026,
    settings: {
      v: 3,
      expectedDurationDays: 1,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-09-30',
      livePolicy: policy,
    },
    policy: {
      policyText: 'Final source language retained verbatim.',
      executionPolicy: structuredClone(policy),
    },
    notes: { bid: 'Preserved source note', positions: null },
    planning: null,
    authoring: null,
    positions: source.map((p) => ({
      id: p.id,
      positionName: p.positionName,
      shift: p.shift,
      station: p.station,
      unit: String(p.unit),
      division: p.division,
      rankRequired: p.rankRequired,
      isFloating: p.isFloating,
      isVacantByDesign: p.isVacantByDesign,
      isExcludedFromCount: p.isExcludedFromCount,
    })),
    rules: rules.map((rule) => ({
      positionId: rule.positionId,
      requiredCriteriaJson: JSON.stringify(rule.requiredCriteria),
      pointsPreferenceJson: JSON.stringify(rule.pointsPreference),
      tieBreakChainJson: JSON.stringify(rule.tieBreakChain),
      notes: null,
    })),
    participation: rules.map((rule) => ({
      positionId: rule.positionId,
      bidParticipation: 'BIDDABLE',
      authoritativeSourceRef: 'Reviewed final 2026 source roles',
    })),
    staffingBindings: [],
    sourceDecisions: [CORRECTED_2026_TOPOLOGY_SOURCE_DECISION],
  });
}
