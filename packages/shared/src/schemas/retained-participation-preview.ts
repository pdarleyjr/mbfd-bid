import { z } from 'zod';
import { BidDefinitionContentSchema } from './bid-definition.js';

const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();
const expected = z
  .object({
    kind: z.literal('version'),
    versionId: identity,
    revision: z.number().int().positive(),
    sha256: hash,
  })
  .strict();
const counts = z
  .object({
    ordinaryParticipants: count,
    stageEntries: count,
    ranks: z.object({ CPT: count, LT: count, FF: count }).strict(),
  })
  .strict();

export const RetainedParticipationPreviewRequestSchema = z.object({ expected }).strict();
export type RetainedParticipationPreviewRequest = z.infer<
  typeof RetainedParticipationPreviewRequestSchema
>;

export const RetainedParticipationPreviewResponseSchema = z
  .object({
    ok: z.literal(true),
    expected,
    proposalSha256: hash,
    content: BidDefinitionContentSchema,
    source: z
      .object({
        freezeId: identity,
        evaluationSha256: hash,
        personnelSha256: hash,
        credentialSha256: hash,
        sourceVersionId: identity,
        sourceVersionSha256: hash,
      })
      .strict(),
    retained: z
      .array(
        z
          .object({
            memberId: z.number().int().positive(),
            rank: z.enum(['CPT', 'LT', 'FF']),
            positionId: identity,
            displayName: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .min(1),
    retainedCount: z.number().int().positive(),
    beforeCounts: counts,
    counts,
  })
  .strict()
  .superRefine((value, ctx) => {
    const freeze =
      value.content.settings?.v === 3 ? value.content.settings.evidenceFreeze : undefined;
    const receipt = freeze?.derivation;
    if (
      value.content.bidYear !== 2026 ||
      !receipt ||
      freeze?.reviewedUpdate !== undefined ||
      receipt.baselineVersionId !== value.expected.versionId ||
      receipt.baselineVersionSha256 !== value.expected.sha256 ||
      receipt.sourceFreezeId !== value.source.freezeId ||
      receipt.sourceEvaluationSha256 !== value.source.evaluationSha256 ||
      receipt.personnelSha256 !== value.source.personnelSha256 ||
      receipt.credentialSha256 !== value.source.credentialSha256 ||
      receipt.sourceVersionId !== value.source.sourceVersionId ||
      receipt.sourceVersionSha256 !== value.source.sourceVersionSha256 ||
      freeze?.freezeId !== value.source.freezeId ||
      freeze.evaluationSha256 !== value.source.evaluationSha256 ||
      freeze.personnelSnapshot.sha256 !== value.source.personnelSha256 ||
      freeze.credentialSnapshot.sha256 !== value.source.credentialSha256 ||
      freeze.sourceVersionId !== value.source.sourceVersionId ||
      freeze.sourceVersionSha256 !== value.source.sourceVersionSha256 ||
      value.retainedCount !== value.retained.length ||
      new Set(value.retained.map((member) => member.memberId)).size !== value.retained.length ||
      new Set(value.retained.map((member) => member.positionId)).size !== value.retained.length ||
      value.beforeCounts.ordinaryParticipants - value.counts.ordinaryParticipants !==
        value.retainedCount ||
      [value.beforeCounts, value.counts].some(
        (entry) => entry.ordinaryParticipants !== entry.ranks.CPT + entry.ranks.LT + entry.ranks.FF,
      ) ||
      value.counts.stageEntries > value.beforeCounts.stageEntries
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The retained source proposal is inconsistent.',
      });
    for (const rank of ['CPT', 'LT', 'FF'] as const)
      if (
        value.beforeCounts.ranks[rank] - value.counts.ranks[rank] !==
        value.retained.filter((member) => member.rank === rank).length
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The retained rank counts are inconsistent.',
        });
  });
export type RetainedParticipationPreviewResponse = z.infer<
  typeof RetainedParticipationPreviewResponseSchema
>;
