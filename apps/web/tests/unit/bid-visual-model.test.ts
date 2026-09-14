import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  BidDispositionSchema,
  type BidImpactResponse,
  BidImpactResponseSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type BidPreview, BidPreviewSchema } from '../../app/admin/current-bid/bid-client';
import {
  BID_VISUAL_LENSES,
  buildBidVisualModel,
  selectBidVisualLens,
} from '../../app/admin/current-bid/bid-visual-model';

const YEAR = 2027;
const BASELINE = 'a'.repeat(64);
const CANDIDATE = 'b'.repeat(64);
const CONTEXT = 'c'.repeat(64);
const RUNTIME = 'd'.repeat(64);
const IMPACT = 'e'.repeat(64);

function rule(positionId: string) {
  return {
    positionId,
    requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
    pointsPreferenceJson: '{"max":0,"items":[]}',
    tieBreakChainJson: '["rsc_seniority","rank_seniority"]',
    notes: null,
  };
}

function content(
  options: { unresolvedStageOpportunity?: boolean; unknownParticipantSourceStage?: boolean } = {},
): BidDefinitionContent {
  const alpha = 'opportunity-alpha';
  const bravo = 'opportunity-bravo';
  const stageOpportunities = [
    alpha,
    ...(options.unresolvedStageOpportunity ? ['missing-seat'] : []),
  ];
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: YEAR,
    settings: null,
    notes: { bid: 'Synthetic visual Bid', positions: null },
    policy: {
      policyText: 'Synthetic authoritative policy language.',
      stageParticipantSources: [
        {
          stageId: 'stage-firefighter',
          sourceRef: 'Synthetic firefighter stage source',
          participantSource: {
            type: 'FILTER',
            active: true,
            bidParticipation: 'BIDDABLE',
            ranks: ['FF', 'LT'],
          },
          ordering: [
            { key: 'RSC_SENIORITY', direction: 'ASC' },
            { key: 'RANK_SENIORITY', direction: 'DESC' },
          ],
        },
        ...(options.unknownParticipantSourceStage
          ? [
              {
                stageId: 'missing-stage',
                sourceRef: 'Synthetic missing-stage source',
                participantSource: { type: 'EXPLICIT_MEMBERS' as const, memberIds: [777] },
                ordering: [{ key: 'RSC_SENIORITY' as const, direction: 'ASC' as const }],
              },
            ]
          : []),
      ],
      executionPolicy: {
        v: 1,
        policyRevision: 'synthetic-policy-revision',
        stages: [
          {
            id: 'stage-firefighter',
            label: 'Firefighter stage',
            order: 0,
            memberIds: [200, 100],
            opportunityPositionIds: stageOpportunities,
            kind: 'FIREFIGHTER',
          },
        ],
        dispositions: BidDispositionSchema.options.map((disposition) => ({
          disposition,
          advances: true,
          returns: false,
          returnStageId: null,
          retainsLaterSelectionRights: false,
          terminal: true,
          requiresReason: true,
          requiresEvidence: false,
          contactPolicyReference: null,
        })),
        actionPermissions: LiveBidActionSchema.options.map((action) => ({
          action,
          actorMemberIds: [100],
        })),
        specialtyCatalogReference: 'Synthetic specialty catalog',
        aDayPolicyReference: null,
        transitionPolicyReference: null,
        publicationPolicyReference: null,
        annualOperations: {
          v: 1,
          stageOrder: ['stage-firefighter'],
          requiredTopologyPositionIds: [alpha],
          specialties: [
            {
              id: 'marine',
              label: 'Marine opportunity coverage',
              mode: 'INTERRUPTING',
              opportunityPositionIds: [alpha],
              requiredCredentialNames: ['Marine Awareness'],
              requiredSpecialtyCodes: ['MARINE'],
              points: [],
              tieBreakChain: ['POINTS'],
            },
          ],
          contact: { minimumAttempts: 2, timingMode: 'TARGET', durationSeconds: 120 },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: 1,
            max: 3,
            captainDcMax: 1,
            specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
          },
        },
      },
    },
    planning: null,
    authoring: {
      profiles: [
        {
          id: 'profile-alpha',
          name: 'Alpha profile',
          sourceRef: 'Synthetic profile source',
          scope: { kind: 'position', positionId: alpha },
          requirements: { ranks: ['FF'], credentials: [], custom: [] },
        },
        {
          id: 'profile-bravo',
          name: 'Bravo profile',
          sourceRef: 'Synthetic profile source',
          scope: { kind: 'position', positionId: bravo },
          requirements: { ranks: ['FF'], credentials: [], custom: [] },
        },
      ],
      compiled: [
        {
          rule: rule(alpha),
          provenance: {
            requirements: ['profile-alpha'],
            scoring: [],
            priorities: [],
            matched: ['profile-alpha'],
          },
        },
        {
          rule: rule(bravo),
          provenance: {
            requirements: ['profile-bravo'],
            scoring: [],
            priorities: [],
            matched: ['profile-bravo'],
          },
        },
      ],
      reconciliation: 'MATCHES_CAPTURED_RULE_REVISION',
    },
    // Deliberately out of lexical order: graph ordering must not depend on authoring order.
    positions: [bravo, alpha].map((id) => ({
      id,
      shift: 'A',
      station: id === alpha ? '1' : '2',
      division: 'Operations',
      unit: id === alpha ? 'Engine 1' : 'Engine 2',
      rankRequired: 'FF',
      positionName: id === alpha ? 'Alpha firefighter' : 'Bravo firefighter',
      isFloating: false,
      isVacantByDesign: false,
      isExcludedFromCount: false,
    })),
    rules: [rule(bravo), rule(alpha)],
    participation: [
      {
        positionId: alpha,
        bidParticipation: 'BIDDABLE',
        authoritativeSourceRef: 'Synthetic participation source',
      },
    ],
    staffingBindings: [
      {
        positionId: alpha,
        staffingPositionId: 'staffing-alpha',
        authoritativeSourceRef: 'Synthetic staffing source',
        reviewStatus: 'approved',
      },
    ],
    sourceDecisions: [
      {
        issueId: 'source-question',
        title: 'Synthetic source question',
        question: 'Which source governs?',
        area: 'rules',
        status: 'OPEN',
        decision: '',
        sourceRef: 'Synthetic policy source',
        effectiveOn: '2027-01-01',
      },
    ],
  });
}

function preview(material: BidDefinitionContent): BidPreview {
  const keyed = { addedIds: [], removedIds: [], changedIds: [] };
  return BidPreviewSchema.parse({
    valid: true,
    content: material,
    contentSha256: CANDIDATE,
    diff: {
      positions: keyed,
      rules: { ...keyed, changedIds: ['opportunity-alpha'] },
      participation: keyed,
      staffingBindings: keyed,
      sourceDecisions: keyed,
      changedSections: ['rules'],
    },
    wouldCreateVersion: true,
    coverage: {
      valid: true,
      ruleCount: 2,
      missingBiddablePositionIds: [],
      invalidPositionIds: [],
      duplicatePositionIds: [],
      nonBiddablePositionIds: [],
      unexpectedPositionIds: [],
    },
    stats: {
      opportunityCount: 2,
      ruleCount: 2,
      biddableCount: 2,
      administrativelyAssignedCount: 0,
      reservedCount: 0,
      excludedCount: 0,
      missingRuleCount: 0,
    },
    mockReadiness: { status: 'NOT_EVALUATED', code: 'saved_version_required_for_mock_preview' },
  });
}

function impact(): BidImpactResponse {
  const pool = {
    pool: 'FF' as const,
    exclusionReason: null,
    authoritativeAssignmentId: null,
    mockParticipationEvidence: null,
  };
  const score = {
    eligible: true,
    points: 7,
    soPoints: 2,
    moPoints: 1,
    priority: 1,
    reasons: ['Synthetic authoritative result'],
  };
  const side = {
    status: 'EVALUATED' as const,
    contextSha256: CONTEXT,
    executionReferenceErrors: [],
    personnelEvaluationOn: '2027-01-01',
    credentialEvaluationOn: '2027-01-01',
    members: [
      { memberId: 200, displayName: 'Bravo Member', rank: 'FF' as const, ...pool },
      { memberId: 100, displayName: 'Alpha Member', rank: 'FF' as const, ...pool },
    ],
    opportunities: [
      { positionId: 'opportunity-bravo', evaluatedMemberCount: 2, eligibleMemberCount: 1 },
      { positionId: 'opportunity-alpha', evaluatedMemberCount: 2, eligibleMemberCount: 2 },
    ],
    stageOrder: {
      status: 'EVALUATED' as const,
      codes: [],
      entries: [
        { ordinal: 2, memberId: 200, stageId: 'stage-firefighter' },
        { ordinal: 1, memberId: 100, stageId: 'stage-firefighter' },
      ],
    },
    specialties: [
      {
        id: 'marine',
        mode: 'INTERRUPTING' as const,
        opportunityPositionIds: ['opportunity-alpha'],
        status: 'EVALUATED' as const,
        code: null,
        candidates: [{ memberId: 100, points: 7, priority: 1 }],
      },
    ],
    selectionConsequences: {
      status: 'REQUIRES_SELECTION_CONTEXT' as const,
      areas: ['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS'],
    },
  };
  const keyed = { addedIds: [], removedIds: [], changedIds: [] };
  return BidImpactResponseSchema.parse({
    valid: true,
    v: 1,
    bidYear: YEAR,
    source: {
      kind: 'UNSAVED_DRAFT',
      baselineContentSha256: BASELINE,
      candidateContentSha256: CANDIDATE,
    },
    mode: 'mock',
    capturedAtMs: 1_800_000_000_000,
    runtimeSourceToken: RUNTIME,
    impactSha256: IMPACT,
    before: side,
    after: side,
    comparison: {
      status: 'EVALUATED',
      affectedMemberIds: [100],
      unavailableAreas: [],
      eligibility: {
        policyComparisonCount: 1,
        evidenceComparisonCount: 0,
        policyChangeCount: 1,
        evidenceChangeCount: 0,
        changeCount: 1,
        changeOffset: 0,
        changes: [
          {
            cause: 'POLICY',
            positionId: 'opportunity-alpha',
            memberId: 100,
            before: { ...score, eligible: false },
            after: score,
          },
        ],
        nextChangeOffset: null,
        incomparable: {
          addedMemberIds: [],
          removedMemberIds: [],
          addedPositionIds: [],
          removedPositionIds: [],
        },
      },
      poolChanges: [],
      stageChanges: [],
      stageOpportunityChanges: [],
      specialtyChanges: [],
    },
    trace: null,
    diff: {
      positions: keyed,
      rules: { ...keyed, changedIds: ['opportunity-alpha'] },
      participation: keyed,
      staffingBindings: keyed,
      sourceDecisions: keyed,
      changedSections: ['rules'],
    },
  });
}

function node(model: ReturnType<typeof buildBidVisualModel>, id: string) {
  const value = model.nodes.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing synthetic visual node ${id}`);
  return value;
}

describe('Bid visual model', () => {
  it('builds stable authored-local structural graph data and bounded lens defaults without inferring members', () => {
    const material = content();
    const reordered = BidDefinitionContentSchema.parse({
      ...material,
      positions: [...material.positions].reverse(),
      rules: [...material.rules].reverse(),
      authoring: material.authoring && {
        ...material.authoring,
        profiles: [...material.authoring.profiles].reverse(),
        compiled: [...material.authoring.compiled].reverse(),
      },
    });

    const first = buildBidVisualModel({ content: material });
    const second = buildBidVisualModel({ content: reordered });

    expect(first).toStrictEqual(second);
    expect(first.nodes.map((value) => value.id)).toContain('opportunity:opportunity-alpha');
    expect(node(first, 'opportunity:opportunity-alpha')).toMatchObject({
      type: 'opportunity',
      group: 'opportunities',
      rank: expect.any(Number),
      summary: expect.any(String),
      provenance: expect.any(Array),
      status: 'AUTHORED',
    });
    expect(first.edges).toContainEqual(
      expect.objectContaining({
        id: 'edge:rule:opportunity-alpha:governs:opportunity:opportunity-alpha',
        source: 'rule:opportunity-alpha',
        target: 'opportunity:opportunity-alpha',
        relationship: 'governs',
        status: 'AUTHORED',
      }),
    );
    expect(first.nodes.some((value) => value.type === 'member')).toBe(false);
    expect(node(first, 'stage-participant-source:stage-firefighter')).toMatchObject({
      type: 'participant-source',
      label: 'FILTER participant source',
      summary:
        'Active BIDDABLE ranks: FF, LT. Ordering: RSC_SENIORITY ASC → RANK_SENIORITY DESC. Saved selector authoring only; roster resolution is pending a pinned server evaluation.',
      provenance: ['Synthetic firefighter stage source'],
      status: 'AUTHORED',
      group: 'flow',
    });
    expect(first.edges).toContainEqual(
      expect.objectContaining({
        id: 'edge:stage-participant-source:stage-firefighter:governs:stage:stage-firefighter',
        source: 'stage-participant-source:stage-firefighter',
        target: 'stage:stage-firefighter',
        relationship: 'governs',
        status: 'AUTHORED',
      }),
    );
    expect(first.lenses.flow.nodeIds).toContain('stage-participant-source:stage-firefighter');
    expect(first.nodes.some((value) => value.status === 'READY')).toBe(false);
    expect(first.edges.some((value) => value.status === 'READY')).toBe(false);
    expect(Object.keys(first.lenses)).toEqual([...BID_VISUAL_LENSES]);
    expect(first.lenses.opportunities.nodeIds).toContain('opportunity:opportunity-alpha');
    expect(first.lenses.opportunities.defaultNodeIds.length).toBeLessThanOrEqual(
      first.lenses.opportunities.nodeIds.length,
    );
    expect(selectBidVisualLens(first, 'opportunities')).toMatchObject({
      projection: first.lenses.opportunities,
    });
  });

  it('keeps typed participant selector authoring separate from unresolved legacy member references', () => {
    const model = buildBidVisualModel({ content: content() });

    expect(node(model, 'stage:stage-firefighter')).toMatchObject({
      summary:
        'FIREFIGHTER · typed participant selector authoring; roster resolution pending a pinned server evaluation. · 1 opportunities.',
    });
    expect(node(model, 'aggregate:members')).toMatchObject({
      summary:
        '0 configured legacy stage-member references; 1 typed participant selector authoring record awaits pinned server resolution.',
    });
    expect(node(model, 'stage-participant-source:stage-firefighter')).toMatchObject({
      status: 'AUTHORED',
      summary:
        'Active BIDDABLE ranks: FF, LT. Ordering: RSC_SENIORITY ASC → RANK_SENIORITY DESC. Saved selector authoring only; roster resolution is pending a pinned server evaluation.',
    });
    expect(
      model.nodes.some((value) =>
        value.id.startsWith('unresolved:stage-member:stage-firefighter:'),
      ),
    ).toBe(false);
    expect(
      model.edges.some(
        (edge) =>
          edge.source === 'stage:stage-firefighter' &&
          edge.relationship === 'participates-in' &&
          edge.impact === undefined,
      ),
    ).toBe(false);
  });

  it('copies only authoritative preview and impact facts into affected node metadata and lenses', () => {
    const material = content();
    const model = buildBidVisualModel({
      content: material,
      preview: preview(material),
      impact: impact(),
    });

    expect(node(model, 'rule:opportunity-alpha')).toMatchObject({
      status: 'CHANGED',
      impact: expect.objectContaining({
        source: 'PREVIEW',
        status: 'VALID',
        contentSha256: CANDIDATE,
        changedSections: ['rules'],
      }),
    });
    expect(node(model, 'analysis:preview')).toMatchObject({
      label: 'Server preview',
      status: 'READY',
      impact: expect.objectContaining({ source: 'PREVIEW', status: 'VALID' }),
    });
    expect(node(model, 'analysis:impact')).toMatchObject({
      label: 'Mock server impact',
      status: 'READY',
      impact: expect.objectContaining({ source: 'IMPACT', status: 'EVALUATED' }),
    });
    expect(node(model, 'opportunity:opportunity-alpha')).toMatchObject({
      impact: expect.objectContaining({
        source: 'IMPACT',
        status: 'EVALUATED',
        mode: 'mock',
        impactSha256: IMPACT,
        evaluatedMemberCount: 2,
        eligibleMemberCount: 2,
      }),
    });
    expect(node(model, 'member:100')).toMatchObject({
      label: 'Alpha Member',
      type: 'member',
      status: 'CHANGED',
      impact: expect.objectContaining({ source: 'IMPACT', status: 'EVALUATED', changeCount: 1 }),
    });
    expect(model.lenses.members.nodeIds).toContain('member:100');
    expect(model.lenses.changes.nodeIds).toContain('change:eligibility:opportunity-alpha:100:0');
    expect(model.lenses.specialty.nodeIds).toContain('specialty:marine');
  });

  it('surfaces missing configured references as explicit unresolved nodes and edges', () => {
    const model = buildBidVisualModel({ content: content({ unresolvedStageOpportunity: true }) });
    const unresolvedId = 'unresolved:stage-opportunity:stage-firefighter:missing-seat';

    expect(node(model, unresolvedId)).toMatchObject({
      type: 'unresolved',
      status: 'UNRESOLVED',
      label: 'UNRESOLVED opportunity missing-seat',
    });
    expect(model.edges).toContainEqual(
      expect.objectContaining({
        source: 'stage:stage-firefighter',
        target: unresolvedId,
        relationship: 'offers',
        status: 'UNRESOLVED',
      }),
    );
    expect(model.edges.some((edge) => edge.target === 'opportunity:missing-seat')).toBe(false);
    expect(model.lenses.flow.nodeIds).toContain(unresolvedId);
  });

  it('shows an unknown participant-source stage as unresolved without inferring its members', () => {
    const material = content({ unknownParticipantSourceStage: true });
    if (!material.policy?.stageParticipantSources)
      throw new Error('Synthetic participant-source fixture is missing');
    const reordered = BidDefinitionContentSchema.parse({
      ...material,
      policy: {
        ...material.policy,
        stageParticipantSources: [...material.policy.stageParticipantSources].reverse(),
      },
    });
    const model = buildBidVisualModel({ content: material });
    const sourceId = 'stage-participant-source:missing-stage';
    const unresolvedId = 'unresolved:participant-source-stage:missing-stage';

    expect(model).toStrictEqual(buildBidVisualModel({ content: reordered }));
    expect(node(model, sourceId)).toMatchObject({
      type: 'participant-source',
      label: 'EXPLICIT_MEMBERS participant source',
      summary:
        'Explicit member IDs: 777. Ordering: RSC_SENIORITY ASC. Saved selector authoring only; roster resolution is pending a pinned server evaluation.',
      provenance: ['Synthetic missing-stage source'],
      status: 'UNRESOLVED',
    });
    expect(node(model, unresolvedId)).toMatchObject({
      type: 'unresolved',
      label: 'UNRESOLVED stage missing-stage',
      status: 'UNRESOLVED',
    });
    expect(model.edges).toContainEqual(
      expect.objectContaining({
        source: sourceId,
        target: unresolvedId,
        relationship: 'governs',
        status: 'UNRESOLVED',
      }),
    );
    expect(model.nodes.some((value) => value.id === 'member:777')).toBe(false);
  });

  it('fails closed when a valid preview describes a different draft', () => {
    const material = content();
    const other = BidDefinitionContentSchema.parse({
      ...material,
      notes: { ...material.notes, bid: 'A different synthetic draft' },
    });
    const model = buildBidVisualModel({ content: material, preview: preview(other) });

    expect(node(model, 'analysis:preview-context')).toMatchObject({
      type: 'analysis',
      status: 'UNRESOLVED',
      impact: expect.objectContaining({ source: 'PREVIEW', status: 'UNAVAILABLE' }),
    });
    expect(node(model, 'rule:opportunity-alpha').status).toBe('AUTHORED');
  });
});
