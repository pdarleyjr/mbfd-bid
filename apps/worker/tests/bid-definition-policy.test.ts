import {
  type BidDefinitionContent,
  BidDispositionSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type StageParticipantSourceDefinitions,
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

function typedStageSources(): StageParticipantSourceDefinitions {
  return [
    {
      stageId: 'synthetic-first',
      sourceRef: 'Synthetic first-stage roster evidence.',
      participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [101, 102] },
      ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
    },
    {
      stageId: 'synthetic-second',
      sourceRef: 'Synthetic second-stage roster evidence.',
      participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [103, 104] },
      ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
    },
  ];
}

function requestOpenOrderingAuthority(candidate: BidDefinitionContent) {
  if (!candidate.policy) throw new Error('Synthetic policy required');
  candidate.policy.orderingAuthority = {
    v: 1,
    sourceDecisionId: 'synthetic-unresolved-ordering-decision',
    comparator: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
  };
  candidate.sourceDecisions = [
    {
      issueId: 'synthetic-unresolved-ordering-decision',
      title: 'Synthetic unresolved annual ordering authority',
      question: 'Which reviewed comparator governs this synthetic Bid?',
      area: 'annual-policy',
      status: 'OPEN',
      decision: 'Awaiting review.',
      sourceRef: 'Synthetic annual-policy evidence.',
      effectiveOn: '2027-01-01',
    },
  ];
}

describe('Bid definition policy normalization and validation', () => {
  it.each([
    [
      'omits an execution-policy stage',
      (sources: StageParticipantSourceDefinitions) => sources.slice(0, 1),
    ],
    [
      'names a stage absent from the execution policy',
      (sources: StageParticipantSourceDefinitions) => [
        ...sources,
        { ...entry(sources, 1), stageId: 'synthetic-unconfigured-stage' },
      ],
    ],
  ] as const)(
    'rejects typed stage authoring that %s at the canonical save boundary',
    (_label, edit) => {
      const candidate = definition();
      if (!candidate.policy) throw new Error('Synthetic policy required');
      candidate.policy.stageParticipantSources = edit(typedStageSources());

      const result = canonicalBidDefinition(candidate);

      expect(result).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['policy', 'stageParticipantSources'],
            code: 'stage_participant_source_stage_mismatch',
          }),
        ]),
      });
    },
  );

  it('rejects typed stage ordering that disagrees with the saved ordering-authority request', () => {
    const candidate = definition();
    if (!candidate.policy) throw new Error('Synthetic policy required');
    const sources = typedStageSources();
    entry(sources).ordering = [{ key: 'RSC_SENIORITY', direction: 'ASC' }];
    candidate.policy.stageParticipantSources = sources;
    requestOpenOrderingAuthority(candidate);

    const result = canonicalBidDefinition(candidate);

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ['policy', 'stageParticipantSources', 0, 'ordering'],
          code: 'stage_participant_source_ordering_mismatch',
        }),
      ]),
    });
  });

  it('rejects an ordering-authority request that names no saved source decision', () => {
    const candidate = definition();
    requestOpenOrderingAuthority(candidate);
    candidate.sourceDecisions = [];

    expect(canonicalBidDefinition(candidate)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ['policy', 'orderingAuthority', 'sourceDecisionId'],
          code: 'ordering_authority_source_decision_missing',
        }),
      ]),
    });
  });

  it('rejects an ordering-authority request outside annual-policy evidence', () => {
    const candidate = definition();
    requestOpenOrderingAuthority(candidate);
    entry(candidate.sourceDecisions).area = 'rules';

    expect(canonicalBidDefinition(candidate)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ['policy', 'orderingAuthority', 'sourceDecisionId'],
          code: 'ordering_authority_source_decision_not_annual_policy',
        }),
      ]),
    });
  });

  it('keeps matching typed sources representable while their ordering source decision is unresolved', () => {
    const candidate = definition();
    if (!candidate.policy) throw new Error('Synthetic policy required');
    candidate.policy.stageParticipantSources = typedStageSources();
    requestOpenOrderingAuthority(candidate);

    const result = accepted(candidate);

    expect(result.content.policy?.orderingAuthority).toEqual(candidate.policy.orderingAuthority);
    expect(result.content.policy?.executionPolicy.orderingAuthority).toBeUndefined();
  });

  it('suppresses semantic no-ops in typed selector row and predicate-set order', () => {
    const baselineCandidate = definition();
    if (!baselineCandidate.policy) throw new Error('Synthetic policy required');
    const baselineSources = typedStageSources();
    baselineSources[1] = {
      ...entry(baselineSources, 1),
      participantSource: {
        type: 'FILTER',
        active: true,
        bidParticipation: 'BIDDABLE',
        ranks: ['CPT', 'FF'],
      },
    };
    baselineCandidate.policy.stageParticipantSources = baselineSources;
    const baseline = accepted(baselineCandidate);

    const reorderedCandidate = structuredClone(baselineCandidate);
    const reorderedPolicy = reorderedCandidate.policy;
    const reorderedSources = reorderedPolicy?.stageParticipantSources;
    if (reorderedPolicy === null || reorderedSources === undefined)
      throw new Error('Typed sources required');
    const first = entry(reorderedSources);
    const second = entry(reorderedSources, 1);
    if (
      first.participantSource.type !== 'EXPLICIT_MEMBERS' ||
      second.participantSource.type !== 'FILTER'
    )
      throw new Error('Synthetic typed source kinds required');
    reorderedPolicy.stageParticipantSources = [
      {
        ...second,
        participantSource: {
          ...second.participantSource,
          ranks: [...second.participantSource.ranks].reverse(),
        },
      },
      {
        ...first,
        participantSource: {
          ...first.participantSource,
          memberIds: [...first.participantSource.memberIds].reverse(),
        },
      },
    ];

    expect(accepted(reorderedCandidate)).toEqual(baseline);
  });

  it('retains typed selector comparator precedence', () => {
    const baselineCandidate = definition();
    if (!baselineCandidate.policy) throw new Error('Synthetic policy required');
    baselineCandidate.policy.stageParticipantSources = typedStageSources().map((source) => ({
      ...source,
      ordering: [
        { key: 'RSC_SENIORITY', direction: 'ASC' },
        { key: 'RANK_SENIORITY', direction: 'ASC' },
      ],
    }));
    const baseline = accepted(baselineCandidate);

    const changedCandidate = structuredClone(baselineCandidate);
    const changedPolicy = changedCandidate.policy;
    const changedSources = changedPolicy?.stageParticipantSources;
    if (changedPolicy === null || changedSources === undefined)
      throw new Error('Typed sources required');
    changedPolicy.stageParticipantSources = changedSources.map((source) => ({
      ...source,
      ordering: [
        { key: 'RANK_SENIORITY', direction: 'ASC' },
        { key: 'RSC_SENIORITY', direction: 'ASC' },
      ],
    }));

    expect(accepted(changedCandidate).sha256).not.toBe(baseline.sha256);
  });

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
