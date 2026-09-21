import { describe, expect, it } from 'vitest';
import { BidStageParticipantPreviewResponseSchema } from '../../src/index.js';

const digest = 'a'.repeat(64);

function response() {
  return {
    valid: true,
    v: 1,
    bidYear: 2027,
    definition: {
      kind: 'LEGACY_SOURCE',
      sourceToken: digest,
    },
    source: {
      kind: 'UNSAVED_DRAFT',
      baselineContentSha256: digest,
      candidateContentSha256: digest,
    },
    capturedAtMs: 1,
    runtimeSourceToken: digest,
    contextSha256: digest,
    participantPreviewSha256: digest,
    orderingAuthority: {
      status: 'UNRESOLVED',
      request: null,
      code: 'ordering_authority_unconfigured',
    },
    membership: { status: 'RESOLVED_FOR_PREVIEW' },
    stages: [
      {
        stageId: 'synthetic-stage',
        label: 'Synthetic stage',
        order: 0,
        source: {
          sourceRef: 'Synthetic source reference',
          participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [1, 2] },
          ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
        },
        matchedMemberIds: [1, 2],
        displayOrder: 'MEMBER_ID_ASC',
        matchedMembers: [
          {
            memberId: 1,
            displayName: 'Synthetic First',
            rank: 'FF',
            rscSeniority: 1,
            rankSeniority: 1,
          },
          {
            memberId: 2,
            displayName: 'Synthetic Second',
            rank: 'FF',
            rscSeniority: 2,
            rankSeniority: 2,
          },
        ],
      },
    ],
    executionReady: false,
    executionIssues: ['ordering_authority_unconfigured'],
  };
}

describe('stage participant membership preview response', () => {
  it('accepts only a strictly ascending server-provided member-ID display sequence', () => {
    expect(BidStageParticipantPreviewResponseSchema.safeParse(response()).success).toBe(true);

    const invalid = response();
    invalid.stages[0].matchedMemberIds = [2, 1];
    invalid.stages[0].matchedMembers = [
      invalid.stages[0].matchedMembers[1],
      invalid.stages[0].matchedMembers[0],
    ];
    expect(BidStageParticipantPreviewResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('permits named filter exceptions only as a deterministic captured display list', () => {
    const withExceptions = response();
    withExceptions.stages[0].source.participantSource = {
      type: 'FILTER',
      active: true,
      bidParticipation: 'BIDDABLE',
      ranks: ['FF'],
      includeMemberIds: [1],
      excludeMemberIds: [2],
    };
    withExceptions.stages[0].exceptionMembers = [
      { memberId: 1, displayName: 'Synthetic First' },
      { memberId: 2, displayName: 'Synthetic Second' },
    ];
    expect(BidStageParticipantPreviewResponseSchema.safeParse(withExceptions).success).toBe(true);

    withExceptions.stages[0].exceptionMembers = [
      { memberId: 2, displayName: 'Synthetic Second' },
      { memberId: 1, displayName: 'Synthetic First' },
    ];
    expect(BidStageParticipantPreviewResponseSchema.safeParse(withExceptions).success).toBe(false);
  });

  it('rejects impossible readiness or partial-membership states', () => {
    const falseReady = response();
    falseReady.executionReady = true;
    expect(BidStageParticipantPreviewResponseSchema.safeParse(falseReady).success).toBe(false);

    const unexplained = response();
    unexplained.executionIssues = [];
    expect(BidStageParticipantPreviewResponseSchema.safeParse(unexplained).success).toBe(false);

    const partial = response();
    partial.membership = {
      status: 'BLOCKED',
      code: 'stage_authoring_population_incomplete',
      stageId: null,
      memberIds: [3],
    };
    partial.executionIssues = ['stage_authoring_population_incomplete'];
    expect(BidStageParticipantPreviewResponseSchema.safeParse(partial).success).toBe(false);

    const emptyResolved = response();
    emptyResolved.stages = [];
    expect(BidStageParticipantPreviewResponseSchema.safeParse(emptyResolved).success).toBe(false);

    const overlap = response();
    const duplicateStage = structuredClone(overlap.stages[0]);
    duplicateStage.stageId = 'another-stage';
    duplicateStage.order = 1;
    overlap.stages.push(duplicateStage);
    expect(BidStageParticipantPreviewResponseSchema.safeParse(overlap).success).toBe(false);
  });
});
