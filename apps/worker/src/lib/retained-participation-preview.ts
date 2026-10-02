import {
  type BidDefinitionContent,
  type BidEvaluation,
  RetainedParticipationPreviewRequestSchema,
  RetainedParticipationPreviewResponseSchema,
} from '@mbfd/shared';
import { getDb } from '../db/index.js';
import { canonicalBidDefinition } from './bid-definition-content.js';
import { bidEvidenceFreezeSettingsMatch } from './bid-definition-context.js';
import { prepareBidDefinitionRun } from './bid-definition-run.js';
import { loadBidDefinitionHead, loadBidDefinitionVersion } from './bid-definition-version.js';
import { loadBidEvidenceFreeze } from './bid-evidence-freeze.js';
import { recomputeOriginalReservedRetention } from './bid-policy.js';
import { createRetainedParticipationReceipt } from './retained-participation-receipt.js';

const fail = (error: string) => ({ ok: false as const, error });

/** The normal operator must review and Save this already-known source issue
 * before a successor seals its decision bundle. No other decision is approved
 * or required by this preview. Duplicate decisions also fail closed. */
export function retainedParticipationSourceDecisionIssue(content: BidDefinitionContent) {
  const decisions = content.sourceDecisions.filter(
    (decision) => decision.issueId === '2026-latest-lieutenant-capacity',
  );
  return decisions.length === 1 && decisions[0]?.status === 'RESOLVED'
    ? null
    : 'retained_participation_source_decision_required';
}

function counts(evaluation: BidEvaluation, content: BidDefinitionContent) {
  const ranks = { CPT: 0, LT: 0, FF: 0 };
  for (const member of evaluation.members)
    if (
      member.pool !== 'EXCLUDED' &&
      (member.rank === 'CPT' || member.rank === 'LT' || member.rank === 'FF')
    )
      ranks[member.rank]++;
  return {
    ordinaryParticipants: ranks.CPT + ranks.LT + ranks.FF,
    stageEntries:
      content.settings?.v === 3
        ? content.settings.livePolicy.stages.reduce((sum, stage) => sum + stage.memberIds.length, 0)
        : 0,
    ranks,
  };
}

/** A read-only proposal from the actual current immutable baseline. Normal
 * authenticated semantic Save remains the only way to adopt this content.
 * No member list, evidence document, decision resolution or receipt ID is
 * accepted from the caller, and no current Department rows supply facts. */
export async function previewRetainedParticipation(
  database: D1Database,
  year: number,
  input: unknown,
) {
  const checked = RetainedParticipationPreviewRequestSchema.safeParse(input);
  if (!checked.success || year !== 2026) return fail('invalid_retained_participation_request');
  const expected = checked.data.expected;
  try {
    const head = await loadBidDefinitionHead(database, year);
    if (!head || head.versionId !== expected.versionId || head.revision !== expected.revision)
      return fail('retained_participation_source_changed');
    const baseline = await loadBidDefinitionVersion(database, year, head.versionId);
    if (!baseline.ok || baseline.sha256 !== expected.sha256)
      return fail('retained_participation_source_changed');
    const decisionIssue = retainedParticipationSourceDecisionIssue(baseline.content);
    if (decisionIssue) return fail(decisionIssue);
    const settings = baseline.content.settings;
    const pin = settings?.v === 3 ? settings.evidenceFreeze : undefined;
    if (!pin || pin.derivation !== undefined || pin.reviewedUpdate !== undefined)
      return fail('retained_participation_original_pin_required');
    const saved = await loadBidEvidenceFreeze(getDb(database), year);
    if (!saved || saved.row.id !== pin.freezeId)
      return fail('retained_participation_original_pin_required');
    const captureSource = await loadBidDefinitionVersion(
      database,
      year,
      saved.row.source_version_id,
    );
    if (
      !captureSource.ok ||
      captureSource.sha256 !== saved.row.source_version_sha256 ||
      captureSource.row.content_sha256 !== saved.row.source_version_sha256 ||
      !captureSource.content.settings ||
      !settings ||
      !bidEvidenceFreezeSettingsMatch({
        pinnedEvaluation: saved.evaluation,
        settings,
        content: baseline.content,
      }) ||
      !bidEvidenceFreezeSettingsMatch({
        pinnedEvaluation: saved.evaluation,
        settings: captureSource.content.settings,
        content: captureSource.content,
      })
    )
      return fail('retained_participation_preview_failed');
    // Reuse the ordinary pin/material preparation checks before deriving a
    // proposal. This temporary context is never persisted as a bid session.
    const prepared = await prepareBidDefinitionRun(database, {
      year,
      versionId: baseline.row.id,
      versionSha256: baseline.sha256,
      bidSessionId: `retained-preview-${baseline.row.id}`,
      capturedAtMs: Date.now(),
      mode: 'mock',
    });
    if (!prepared.ok) return fail('retained_participation_preview_failed');
    const recomputed = await recomputeOriginalReservedRetention(
      getDb(database),
      saved,
      baseline.content,
    );
    if (!recomputed) return fail('retained_participation_preview_failed');
    const derived = createRetainedParticipationReceipt({
      baseline: { id: baseline.row.id, sha256: baseline.sha256, content: baseline.content },
      source: saved.row,
      original: saved.evaluation,
      recomputed: recomputed.evaluation,
      evidence: recomputed.evidence,
    });
    if (!derived.ok) return fail('retained_participation_preview_failed');
    const proposal = canonicalBidDefinition(derived.content);
    if (!proposal.ok) return fail('retained_participation_preview_failed');
    const retained = derived.retainedMemberIds.map((memberId) => {
      const member = saved.evaluation.members.find((row) => row.memberId === memberId);
      const identity = saved.evaluation.operatorIdentityProjection?.find(
        (row) => row.memberId === memberId,
      );
      const retainedMember = derived.evaluation.members.find((row) => row.memberId === memberId);
      const assignment = recomputed.evidence.assignmentRows.find(
        (row) => row.id === retainedMember?.authoritativeAssignmentId,
      );
      const binding = baseline.content.staffingBindings.find(
        (row) => row.staffingPositionId === assignment?.staffingPositionId,
      );
      if (!member || !identity || !binding) throw new Error('retained_source_identity_missing');
      return {
        memberId,
        rank: member.rank,
        positionId: binding.positionId,
        displayName: `${identity.firstName} ${identity.lastName}`.trim(),
      };
    });
    const response = RetainedParticipationPreviewResponseSchema.safeParse({
      ok: true,
      expected,
      proposalSha256: proposal.sha256,
      content: proposal.content,
      source: {
        freezeId: saved.row.id,
        evaluationSha256: saved.row.evaluation_sha256,
        personnelSha256: saved.row.personnel_sha256,
        credentialSha256: saved.row.credential_sha256,
        sourceVersionId: saved.row.source_version_id,
        sourceVersionSha256: saved.row.source_version_sha256,
      },
      retained,
      retainedCount: retained.length,
      beforeCounts: counts(saved.evaluation, baseline.content),
      counts: counts(derived.evaluation, proposal.content),
    });
    if (!response.success) return fail('retained_participation_preview_failed');
    const after = await loadBidDefinitionHead(database, year);
    if (!after || after.versionId !== head.versionId || after.revision !== head.revision)
      return fail('retained_participation_source_changed');
    return response.data;
  } catch {
    return fail('retained_participation_preview_failed');
  }
}
