import {
  type BidDefinitionContent,
  BidDispositionSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { canonicalBidDefinition } from '../src/lib/bid-definition-content.js';

// Explicit synthetic policy and identities; no Department evidence or annual
// normative approval is inferred from these pure definition tests.
function definition(): BidDefinitionContent {
  const policy = FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-policy-review',
    stages: [
      {
        id: 'synthetic-first',
        label: 'First synthetic stage',
        order: 0,
        memberIds: [101, 102],
        opportunityPositionIds: ['synthetic-seat-a', 'synthetic-seat-b'],
        kind: 'MIXED',
      },
      {
        id: 'synthetic-second',
        label: 'Second synthetic stage',
        order: 1,
        memberIds: [103, 104],
        opportunityPositionIds: ['synthetic-seat-c', 'synthetic-seat-d'],
        kind: 'MIXED',
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
      actorMemberIds: [901, 902],
    })),
    specialtyCatalogReference: 'synthetic-specialty-source',
    aDayPolicyReference: 'synthetic-a-day-source',
    transitionPolicyReference: 'synthetic-transition-source',
    publicationPolicyReference: 'synthetic-publication-source',
    annualOperations: {
      v: 1,
      stageOrder: ['synthetic-first', 'synthetic-second'],
      requiredTopologyPositionIds: ['synthetic-seat-a', 'synthetic-seat-b'],
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'PRIORITY_ONLY',
          opportunityPositionIds: ['synthetic-seat-a'],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY', 'RANK_SENIORITY'],
        },
      ],
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 20,
        captainDcMax: 5,
        specialtyMaximums: { MARINE_ASSIGNED: 5, MARINE_FLOAT: 5, DE: 5, SWAT: 5 },
      },
    },
  });
  const positions: BidDefinitionContent['positions'] = ['a', 'b', 'c', 'd'].map((suffix) => ({
    id: `synthetic-seat-${suffix}`,
    shift: 'A',
    station: '7',
    division: 'Combat',
    unit: 'Synthetic Engine',
    rankRequired: 'FF',
    positionName: 'Synthetic Firefighter',
    isFloating: false,
    isVacantByDesign: false,
    isExcludedFromCount: false,
  }));
  return {
    v: 1,
    bidYear: 2027,
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy: policy,
    },
    notes: { bid: null, positions: null },
    policy: {
      policyText: 'Explicit synthetic policy language for definition tests.',
      executionPolicy: structuredClone(policy),
    },
    planning: null,
    authoring: null,
    positions,
    rules: positions.map((position) => ({
      positionId: position.id,
      requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
      pointsPreferenceJson: '{"max":0,"items":[]}',
      tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
      notes: null,
    })),
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  };
}

function changeBothPolicies(
  content: BidDefinitionContent,
  change: (policy: FrozenLiveBidPolicy) => void,
) {
  if (content.settings?.v !== 3 || !content.policy) throw new Error('Synthetic V3 policy required');
  change(content.settings.livePolicy);
  change(content.policy.executionPolicy);
}

function accepted(input: unknown) {
  const result = canonicalBidDefinition(input);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('Synthetic definition rejected');
  return result;
}

function entry<T>(rows: readonly T[], index = 0): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`Missing synthetic fixture entry ${index}`);
  return row;
}

function annual(policy: FrozenLiveBidPolicy) {
  if (!policy.annualOperations) throw new Error('Missing synthetic annual operations');
  return policy.annualOperations;
}

function specialty(policy: FrozenLiveBidPolicy) {
  return entry(annual(policy).specialties ?? []);
}

describe('Bid definition policy normalization and validation', () => {
  it.each([
    ['stage rows', (policy: FrozenLiveBidPolicy) => policy.stages.reverse()],
    ['stage members', (policy: FrozenLiveBidPolicy) => entry(policy.stages).memberIds.reverse()],
    [
      'stage opportunities',
      (policy: FrozenLiveBidPolicy) => entry(policy.stages).opportunityPositionIds.reverse(),
    ],
    ['disposition rows', (policy: FrozenLiveBidPolicy) => policy.dispositions.reverse()],
    ['grant rows', (policy: FrozenLiveBidPolicy) => policy.actionPermissions.reverse()],
    [
      'grant actors',
      (policy: FrozenLiveBidPolicy) => entry(policy.actionPermissions).actorMemberIds.reverse(),
    ],
  ] as const)('suppresses a semantic no-op when %s are reordered', (_label, reorder) => {
    const baseline = accepted(definition());
    const candidate = definition();
    changeBothPolicies(candidate, reorder);
    const result = accepted(candidate);
    expect(result.sha256).toBe(baseline.sha256);
    expect(result.serialized).toBe(baseline.serialized);
    expect(result.content.settings?.v).toBe(3);
    if (result.content.settings?.v !== 3) throw new Error('Expected V3 policy');
    expect(result.content.policy?.executionPolicy).toEqual(result.content.settings.livePolicy);
  });

  it('retains a deliberate change to numeric stage precedence', () => {
    const baseline = accepted(definition());
    const candidate = definition();
    changeBothPolicies(candidate, (policy) => {
      entry(policy.stages).order = 1;
      entry(policy.stages, 1).order = 0;
      annual(policy).stageOrder = ['synthetic-second', 'synthetic-first'];
    });
    const changed = accepted(candidate);
    expect(changed.sha256).not.toBe(baseline.sha256);
    expect(changed.content.policy?.executionPolicy.annualOperations?.stageOrder).toEqual([
      'synthetic-second',
      'synthetic-first',
    ]);
  });

  it('retains ordered specialty priorities', () => {
    const baseline = accepted(definition());
    const candidate = definition();
    changeBothPolicies(candidate, (policy) => {
      specialty(policy).tieBreakChain = ['RSC_SENIORITY', 'POINTS', 'RANK_SENIORITY'];
    });
    expect(accepted(candidate).sha256).not.toBe(baseline.sha256);
  });

  it.each([
    [
      'stage opportunity',
      (policy: FrozenLiveBidPolicy) => {
        entry(policy.stages).opportunityPositionIds = ['synthetic-absent-seat'];
      },
    ],
    [
      'required annual topology',
      (policy: FrozenLiveBidPolicy) => {
        annual(policy).requiredTopologyPositionIds = ['synthetic-absent-seat'];
      },
    ],
    [
      'specialty opportunity',
      (policy: FrozenLiveBidPolicy) => {
        specialty(policy).opportunityPositionIds = ['synthetic-absent-seat'];
      },
    ],
    [
      'annual stage order',
      (policy: FrozenLiveBidPolicy) => {
        annual(policy).stageOrder = ['synthetic-second', 'synthetic-first'];
      },
    ],
  ] as const)(
    'rejects contradictory %s without requiring Department member facts',
    (_label, change) => {
      const candidate = definition();
      changeBothPolicies(candidate, change);
      // Each field remains syntactically valid under the existing policy schema;
      // the definition must also enforce references to its own real topology.
      expect(FrozenLiveBidPolicySchema.safeParse(candidate.policy?.executionPolicy).success).toBe(
        true,
      );
      const result = canonicalBidDefinition(candidate);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Contradictory synthetic policy accepted');
      expect(result.issues.length).toBeGreaterThan(0);
    },
  );

  it.each(['', '   '])(
    'rejects a blank division %j using the frozen topology constraint',
    (division) => {
      const candidate = definition();
      entry(candidate.positions).division = division;
      const result = canonicalBidDefinition(candidate);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Blank synthetic division accepted');
      expect(result.issues.some((issue) => issue.path.join('.') === 'positions.0.division')).toBe(
        true,
      );
    },
  );

  it('handles an explicit undefined optional field without throwing or inventing a date', () => {
    const candidate = definition();
    if (candidate.settings?.v !== 3) throw new Error('Expected V3 policy');
    candidate.settings.personnelEvaluationOn = undefined;
    let result: ReturnType<typeof canonicalBidDefinition> | undefined;
    expect(() => {
      result = canonicalBidDefinition(candidate);
    }).not.toThrow();
    expect(result).toBeDefined();
    if (!result) throw new Error('Missing canonicalization result');
    if (!result.ok) {
      // Rejecting values which cannot be encoded as JSON is also a valid
      // contract, provided the caller receives ordinary structured issues.
      expect(result.issues.length).toBeGreaterThan(0);
      return;
    }
    const { personnelEvaluationOn: _omitted, ...withoutPersonnelDate } = candidate.settings;
    candidate.settings = withoutPersonnelDate;
    expect(result.serialized).toBe(accepted(candidate).serialized);
    expect(result.content.settings).not.toHaveProperty('personnelEvaluationOn');
  });

  it('reports all missing rules for a zero-rule draft while retaining non-biddable topology', () => {
    const candidate = definition();
    candidate.settings = {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
    };
    candidate.policy = null;
    candidate.positions = candidate.positions.slice(0, 3);
    entry(candidate.positions, 2).isExcludedFromCount = true;
    candidate.rules = [];
    candidate.participation = [
      {
        positionId: 'synthetic-seat-b',
        bidParticipation: 'RESERVED_NON_BIDDABLE',
        authoritativeSourceRef: 'Explicit synthetic reservation evidence',
      },
    ];
    const result = accepted(candidate);
    expect(result.coverage.valid).toBe(false);
    expect(result.coverage.expectedBiddablePositionIds).toEqual(['synthetic-seat-a']);
    expect(result.coverage.missingBiddablePositionIds).toEqual(['synthetic-seat-a']);
    expect(result.coverage.reservedPositionIds).toEqual(['synthetic-seat-b']);
    expect(result.coverage.legacyExcludedPositionIds).toEqual(['synthetic-seat-c']);
    expect(result.content.positions.map((position) => position.id)).toEqual([
      'synthetic-seat-a',
      'synthetic-seat-b',
      'synthetic-seat-c',
    ]);
    expect(result.content.rules).toEqual([]);
  });
});
