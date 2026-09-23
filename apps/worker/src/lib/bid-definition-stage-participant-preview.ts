import {
  type BidDefinitionContent,
  BidStageParticipantPreviewResponseSchema,
  type FrozenLiveBidPolicy,
} from '@mbfd/shared';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import {
  bidContentHash,
  canonicalBidDefinition,
  definitionRuleBookMaterial,
} from './bid-definition-content.js';
import { bidDefinitionContextHash } from './bid-definition-context.js';
import { loadCurrentBidDefinition } from './bid-definition-facade.js';
import { captureBidDefinitionControl } from './bid-definition-source.js';
import { SaveBidDefinitionSchema } from './bid-definition-store.js';
import { loadBidDefinitionVersion } from './bid-definition-version.js';
import { resolveFrozenBidOrderingAuthority } from './bid-ordering-authority.js';
import {
  type BidEvaluationEvidence,
  type BidEvaluationPreparation,
  type RuleBookCoverage,
  loadBidEvaluationEvidence,
  prepareCapturedBidEvaluation,
} from './bid-policy.js';
import {
  compileFrozenStageParticipants,
  resolveStageParticipantMembership,
} from './stage-participant-selector.js';

const canonical = (value: unknown) => canonicalize(value as JsonValue);

export const BidStageParticipantPreviewRequestSchema = z
  .object({
    kind: z.literal('stage-participant-membership'),
    expected: SaveBidDefinitionSchema.shape.expected,
    intent: SaveBidDefinitionSchema.shape.intent,
  })
  .strict();
export type BidStageParticipantPreviewRequest = z.infer<
  typeof BidStageParticipantPreviewRequestSchema
>;

/**
 * The only OPEN decision this preview may ignore is the exact, canonical
 * annual-policy ordering question named by this candidate. The omission is
 * local to a read-only membership capture; all other source-decision gates
 * remain enforced by prepareCapturedBidEvaluation.
 */
function sourceDecisionsForParticipantPreview(content: BidDefinitionContent) {
  const request = content.policy?.orderingAuthority;
  const decision =
    request === undefined
      ? undefined
      : content.sourceDecisions.find((entry) => entry.issueId === request.sourceDecisionId);
  if (decision?.status !== 'OPEN' || decision.area !== 'annual-policy')
    return content.sourceDecisions;
  return content.sourceDecisions.filter((entry) => entry.issueId !== decision.issueId);
}

/**
 * Builds the same immutable Department evaluation used by a run. The
 * display-only preview carries the same reviewed rehearsal assumptions as a
 * Mock so the authoring gate cannot reject a participant that Mock creation
 * will admit. It never grants Live participation and creates no version,
 * session, receipt, audit, or execution artifact.
 */
async function prepareParticipantPreviewEvaluation(
  db: ReturnType<typeof getDb>,
  content: BidDefinitionContent,
  coverage: RuleBookCoverage,
  evidence: BidEvaluationEvidence,
  capturedAtMs: number,
): Promise<BidEvaluationPreparation | { ok: false; code: 'stage_authoring_compilation_invalid' }> {
  if (content.settings?.v !== 3 || content.policy === null)
    return { ok: false, code: 'stage_authoring_compilation_invalid' };
  const knownStaffing = new Set(evidence.staffingRows.map((row) => row.id));
  const missing = content.staffingBindings
    .filter((row) => !knownStaffing.has(row.staffingPositionId))
    .map((row) => row.positionId);
  if (missing.length)
    return { ok: false, code: 'non_biddable_staffing_position_not_approved', positionIds: missing };
  return prepareCapturedBidEvaluation(
    db,
    {
      bidYear: content.bidYear,
      settings: content.settings,
      coverage,
      bindings: content.staffingBindings,
      ruleBookMaterial: definitionRuleBookMaterial(content),
      sourceDecisions: sourceDecisionsForParticipantPreview(content),
      policyReferenceJson: [
        ...content.rules.flatMap((rule) => [rule.requiredCriteriaJson, rule.pointsPreferenceJson]),
        JSON.stringify(content.settings.livePolicy),
      ],
    },
    evidence,
    capturedAtMs,
    'participant_preview',
  );
}

function previewDefinitionIdentity(input: BidStageParticipantPreviewRequest['expected']) {
  return input.kind === 'legacy'
    ? { kind: 'LEGACY_SOURCE' as const, sourceToken: input.sourceToken }
    : {
        kind: 'VERSION' as const,
        versionId: input.versionId,
        revision: input.revision,
        contentSha256: input.sha256,
      };
}

function displayNameByMemberId(
  input: Extract<BidEvaluationPreparation, { ok: true }>['evaluation'],
) {
  return new Map(
    (input.operatorIdentityProjection ?? []).map((member) => [
      member.memberId,
      `${member.firstName} ${member.lastName}`.trim() || null,
    ]),
  );
}

function previewStages(input: {
  membership: Extract<ReturnType<typeof resolveStageParticipantMembership>, { ok: true }>;
  executionPolicy: FrozenLiveBidPolicy;
  displayNames: ReadonlyMap<number, string | null>;
}) {
  const stageById = new Map(input.executionPolicy.stages.map((stage) => [stage.id, stage]));
  const stages = [] as Array<{
    stageId: string;
    label: string;
    order: number;
    source: {
      sourceRef: string;
      participantSource: (typeof input.membership.stages)[number]['definition']['participantSource'];
      ordering: (typeof input.membership.stages)[number]['definition']['ordering'];
    };
    matchedMemberIds: number[];
    displayOrder: 'MEMBER_ID_ASC';
    matchedMembers: Array<{
      memberId: number;
      displayName: string | null;
      rank: (typeof input.membership.stages)[number]['matchedMembers'][number]['rank'];
      rscSeniority: number;
      rankSeniority: number | null;
    }>;
    exceptionMembers?: Array<{ memberId: number; displayName: string | null }>;
  }>;
  for (const membership of input.membership.stages) {
    const stage = stageById.get(membership.stageId);
    if (stage === undefined)
      return { ok: false as const, error: 'stage_authoring_compilation_invalid' as const };
    const participantSource = membership.definition.participantSource;
    const exceptionMemberIds =
      participantSource.type === 'FILTER'
        ? [
            ...new Set([
              ...(participantSource.includeMemberIds ?? []),
              ...(participantSource.excludeMemberIds ?? []),
            ]),
          ].sort((left, right) => left - right)
        : [];
    stages.push({
      stageId: stage.id,
      label: stage.label,
      order: stage.order,
      source: {
        sourceRef: membership.definition.sourceRef,
        participantSource,
        ordering: membership.definition.ordering,
      },
      matchedMemberIds: [...membership.matchedMemberIds],
      displayOrder: membership.displayOrder,
      matchedMembers: membership.matchedMembers.map((member) => ({
        memberId: member.memberId,
        displayName: input.displayNames.get(member.memberId) ?? null,
        rank: member.rank,
        rscSeniority: member.rscSeniority,
        rankSeniority: member.rankSeniority,
      })),
      ...(exceptionMemberIds.length
        ? {
            exceptionMembers: exceptionMemberIds.map((memberId) => ({
              memberId,
              displayName: input.displayNames.get(memberId) ?? null,
            })),
          }
        : {}),
    });
  }
  return {
    ok: true as const,
    stages: stages.sort(
      (left, right) => left.order - right.order || left.stageId.localeCompare(right.stageId),
    ),
  };
}

/**
 * Evaluates typed participant membership against exactly one pinned Department
 * capture. This endpoint deliberately returns display-only candidates, never
 * a frozen execution policy or authoritative Bid sequence.
 */
export async function previewBidStageParticipantMembership(
  database: D1Database,
  year: number,
  input: BidStageParticipantPreviewRequest,
) {
  const control = await captureBidDefinitionControl(database, year);
  if (!control) return { ok: false as const, error: 'bid_definition_source_changed' };
  const current = await loadCurrentBidDefinition(database, year);
  if (!current.ok) return current;
  if (canonical(current.response.expected) !== canonical(input.expected))
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  const baseline = canonicalBidDefinition(current.response.content);
  if (!baseline.ok) return { ok: false as const, error: 'bid_definition_source_invalid' };
  const candidate =
    input.intent.operation === 'restore'
      ? await loadBidDefinitionVersion(database, year, input.intent.versionId)
      : canonicalBidDefinition(input.intent.content);
  if (!candidate.ok)
    return 'error' in candidate
      ? candidate
      : { ok: true as const, response: { valid: false as const, issues: candidate.issues } };
  if (candidate.content.bidYear !== year)
    return { ok: false as const, error: 'bid_definition_year_mismatch' };
  const policyAuthoring = candidate.content.policy;
  if (
    candidate.content.settings?.v !== 3 ||
    policyAuthoring === null ||
    policyAuthoring.stageParticipantSources === undefined
  )
    return { ok: false as const, error: 'stage_participant_preview_unavailable' };

  const capturedAtMs = Date.now();
  const db = getDb(database);
  const evidence = await loadBidEvaluationEvidence(db, year);
  const prepared = await prepareParticipantPreviewEvaluation(
    db,
    candidate.content,
    candidate.coverage,
    evidence,
    capturedAtMs,
  );
  if (!prepared.ok) return { ok: false as const, error: prepared.code };

  const ordering = resolveFrozenBidOrderingAuthority({
    request: policyAuthoring.orderingAuthority,
    sourceDecisions: candidate.content.sourceDecisions,
  });
  const membership = resolveStageParticipantMembership({
    pinnedEvaluation: prepared.evaluation,
    executionPolicy: policyAuthoring.executionPolicy,
    stageParticipantSources: policyAuthoring.stageParticipantSources,
  });
  const compiled =
    membership.ok && ordering.ok
      ? compileFrozenStageParticipants({
          membership,
          executionPolicy: policyAuthoring.executionPolicy,
          orderingAuthority: ordering.authority,
        })
      : null;
  const executionIssues = [
    ...(membership.ok ? [] : [membership.code]),
    ...(!ordering.ok ? [ordering.code] : []),
    ...(compiled && !compiled.ok ? [compiled.code] : []),
  ];
  const resolvedStages = membership.ok
    ? previewStages({
        membership,
        executionPolicy: policyAuthoring.executionPolicy,
        displayNames: displayNameByMemberId(prepared.evaluation),
      })
    : { ok: true as const, stages: [] };
  if (!resolvedStages.ok) return { ok: false as const, error: resolvedStages.error };
  const stages = resolvedStages.stages;
  const orderingRequest = policyAuthoring.orderingAuthority;
  if (ordering.ok && orderingRequest === undefined)
    return { ok: false as const, error: 'stage_authoring_compilation_invalid' };
  const orderingAuthority = ordering.ok
    ? {
        status: 'RESOLVED' as const,
        request: orderingRequest,
        authority: ordering.authority,
      }
    : {
        status: 'UNRESOLVED' as const,
        request: orderingRequest ?? null,
        code: ordering.code,
      };
  const membershipStatus = membership.ok
    ? { status: 'RESOLVED_FOR_PREVIEW' as const }
    : {
        status: 'BLOCKED' as const,
        code: membership.code,
        stageId: membership.stageId ?? null,
        memberIds: membership.memberIds ? [...membership.memberIds] : [],
      };
  const contextSha256 = bidDefinitionContextHash(prepared.evaluation);
  const source = {
    kind:
      input.intent.operation === 'restore'
        ? ('RESTORE_CANDIDATE' as const)
        : ('UNSAVED_DRAFT' as const),
    baselineContentSha256: baseline.sha256,
    candidateContentSha256: candidate.sha256,
  };
  const participantPreviewSha256 = bidContentHash(
    canonical({
      v: 1,
      definition: previewDefinitionIdentity(input.expected),
      source,
      contextSha256,
      orderingAuthority,
      membership: membershipStatus,
      stages: stages.map((stage) => ({
        stageId: stage.stageId,
        source: stage.source,
        matchedMemberIds: stage.matchedMemberIds,
        displayOrder: stage.displayOrder,
      })),
      executionReady: executionIssues.length === 0,
      executionIssues,
    }),
  );
  const refreshed = await loadCurrentBidDefinition(database, year);
  const afterControl = await captureBidDefinitionControl(database, year);
  if (
    !refreshed.ok ||
    canonical(refreshed.response.expected) !== canonical(input.expected) ||
    !afterControl ||
    afterControl.token !== control.token
  )
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  return {
    ok: true as const,
    response: BidStageParticipantPreviewResponseSchema.parse({
      valid: true as const,
      v: 1 as const,
      bidYear: year,
      definition: previewDefinitionIdentity(input.expected),
      source,
      capturedAtMs,
      runtimeSourceToken: control.token,
      contextSha256,
      participantPreviewSha256,
      orderingAuthority,
      membership: membershipStatus,
      stages,
      executionReady: executionIssues.length === 0,
      executionIssues,
    }),
  };
}
