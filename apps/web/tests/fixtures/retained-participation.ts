import {
  BidDefinitionContentSchema,
  BidDispositionSchema,
  LiveBidActionSchema,
  RetainedParticipationPreviewResponseSchema,
} from '@mbfd/shared';
import { CurrentBidSchema } from '../../app/admin/current-bid/bid-client';

/** Explicit synthetic presentation material, never Department evidence. */
export function retainedParticipationFixture() {
  const expected = {
    kind: 'version' as const,
    versionId: 'synthetic-retention-baseline',
    revision: 12,
    sha256: 'a'.repeat(64),
  };
  const source = {
    freezeId: 'synthetic-original-freeze',
    evaluationSha256: 'b'.repeat(64),
    personnelSha256: 'c'.repeat(64),
    credentialSha256: 'd'.repeat(64),
    sourceVersionId: 'synthetic-original-source',
    sourceVersionSha256: 'e'.repeat(64),
  };
  const retained = [
    {
      memberId: 950001,
      rank: 'CPT' as const,
      positionId: 'SYN-CPT-RETAINED',
      displayName: 'Synthetic Retained Captain',
    },
    ...[22, 23, 24].map((ordinal) => ({
      memberId: 950000 + ordinal,
      rank: 'LT' as const,
      positionId: `SYN-LT-RETAINED-${ordinal}`,
      displayName: `Synthetic Retained Lieutenant ${ordinal}`,
    })),
  ];
  const retainedIds = new Set(retained.map((member) => member.memberId));
  const ids = Array.from({ length: 222 }, (_, index) => 950001 + index);
  const stages = [
    {
      id: 'synthetic-days',
      label: 'Synthetic Days',
      kind: 'D_SHIFT' as const,
      memberIds: ids.slice(0, 62),
    },
    {
      id: 'synthetic-captains',
      label: 'Synthetic Captains',
      kind: 'CAPTAIN' as const,
      memberIds: ids.slice(0, 21),
    },
    {
      id: 'synthetic-lieutenants',
      label: 'Synthetic Lieutenants',
      kind: 'LIEUTENANT' as const,
      memberIds: ids.slice(21, 62),
    },
    {
      id: 'synthetic-firefighters',
      label: 'Synthetic Firefighters',
      kind: 'FIREFIGHTER' as const,
      memberIds: ids.slice(62),
    },
  ].map((stage, order) => ({ ...stage, order, opportunityPositionIds: ['SYN-OPEN'] }));
  const policy = {
    v: 1 as const,
    policyRevision: 'Synthetic retained participation source',
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
      contactPolicyReference: 'Synthetic contact authority',
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [950001],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: 'Synthetic A-Day source',
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };
  const content = BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: 2026,
    settings: {
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-09-30',
      personnelEvaluationOn: '2026-09-30',
      livePolicy: policy,
      evidenceFreeze: {
        freezeId: source.freezeId,
        evaluationSha256: source.evaluationSha256,
        sourceVersionId: source.sourceVersionId,
        sourceVersionSha256: source.sourceVersionSha256,
        evidenceCutoffAt: '2026-09-30T17:00:00-04:00',
        timeZone: 'America/New_York',
        approvedAt: '2026-09-30T21:05:00.000Z',
        sourceImports: [
          {
            source: 'Synthetic credentials',
            importId: 'synthetic-import',
            sha256: 'f'.repeat(64),
            revision: 'Synthetic V4',
            acceptedAt: '2026-09-30T20:00:00.000Z',
          },
        ],
        personnelSnapshot: {
          sha256: source.personnelSha256,
          asOfAt: '2026-09-30T21:00:00.000Z',
          capturedAt: '2026-09-30T21:05:00.000Z',
        },
        credentialSnapshot: {
          sha256: source.credentialSha256,
          asOfAt: '2026-09-30T21:00:00.000Z',
          capturedAt: '2026-09-30T21:05:00.000Z',
        },
      },
    },
    notes: { bid: 'Synthetic retained source notes', positions: null },
    policy: { policyText: 'Synthetic retained source language', executionPolicy: policy },
    planning: null,
    authoring: null,
    positions: retained.map((member) => ({
      id: member.positionId,
      shift: 'A',
      station: 'Synthetic',
      unit: 'Synthetic',
      division: 'Synthetic',
      rankRequired: member.rank,
      positionName: 'Synthetic retained position',
      isFloating: false,
      isVacantByDesign: false,
      isExcludedFromCount: false,
    })),
    rules: [],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [
      {
        issueId: '2026-latest-lieutenant-capacity',
        title: 'Synthetic LT source',
        question: 'Synthetic authority?',
        area: 'annual-policy',
        status: 'RESOLVED',
        sourceRef: 'Synthetic resolved authority',
        decision: 'Keep the synthetic reviewed source',
        effectiveOn: '2026-09-30',
      },
    ],
  });
  const proposalContent = structuredClone(content);
  if (
    proposalContent.settings?.v !== 3 ||
    !proposalContent.settings.evidenceFreeze ||
    !proposalContent.policy
  )
    throw new Error('Synthetic retained source fixture requires its pin and policy.');
  const retainedStages = stages.map((stage) => ({
    ...stage,
    memberIds: stage.memberIds.filter((id) => !retainedIds.has(id)),
  }));
  proposalContent.settings.livePolicy.stages = retainedStages;
  proposalContent.policy.executionPolicy.stages = retainedStages;
  proposalContent.participation = retained.map((member) => ({
    positionId: member.positionId,
    bidParticipation: 'RESERVED_NON_BIDDABLE',
    authoritativeSourceRef: 'Synthetic verified retained assignment',
  }));
  proposalContent.settings.evidenceFreeze.derivation = {
    v: 1,
    method: 'VERIFIED_RESERVED_RETENTION',
    evaluatorRevision: 'reserved-retention-with-sealed-qualifications-v1',
    baselineVersionId: expected.versionId,
    baselineVersionSha256: expected.sha256,
    sourceFreezeId: source.freezeId,
    sourceEvaluationSha256: source.evaluationSha256,
    sourceVersionId: source.sourceVersionId,
    sourceVersionSha256: source.sourceVersionSha256,
    personnelSha256: source.personnelSha256,
    credentialSha256: source.credentialSha256,
    materialSha256: '1'.repeat(64),
    derivedEvaluationSha256: '2'.repeat(64),
  };
  const proposal = RetainedParticipationPreviewResponseSchema.parse({
    ok: true,
    expected,
    source,
    proposalSha256: '3'.repeat(64),
    content: proposalContent,
    retained,
    retainedCount: 4,
    beforeCounts: {
      ordinaryParticipants: 222,
      stageEntries: 284,
      ranks: { CPT: 21, LT: 41, FF: 160 },
    },
    counts: { ordinaryParticipants: 218, stageEntries: 276, ranks: { CPT: 20, LT: 38, FF: 160 } },
  });
  const base = CurrentBidSchema.parse({
    bidYear: 2026,
    state: 'VERSIONED',
    expected,
    content,
    version: {
      id: expected.versionId,
      versionNumber: expected.revision,
      contentSha256: expected.sha256,
      createdAtMs: 1790878800000,
      actorSubject: 'synthetic-admin',
      reason: 'Synthetic normal LT decision Save',
      predecessorId: 'synthetic-prior',
      restoredFromId: null,
    },
    coverage: {
      valid: true,
      ruleCount: 0,
      missingBiddablePositionIds: [],
      invalidPositionIds: [],
      duplicatePositionIds: [],
      nonBiddablePositionIds: [],
      unexpectedPositionIds: [],
    },
    stats: {
      opportunityCount: 4,
      ruleCount: 0,
      biddableCount: 4,
      administrativelyAssignedCount: 0,
      reservedCount: 0,
      excludedCount: 0,
      missingRuleCount: 0,
    },
  });
  return { base, proposal };
}
