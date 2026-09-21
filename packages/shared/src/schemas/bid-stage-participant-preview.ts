import { z } from 'zod';
import { BidOrderingAuthorityRequestSchema } from './bid-definition.js';
import {
  FrozenBidOrderingAuthoritySchema,
  StageParticipantOrderingSchema,
  StageParticipantSourceSchema,
} from './bid-policy.js';

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const IdentitySchema = z.string().trim().min(1).max(200);
const MemberIdSchema = z.number().int().positive();
const PreviewMemberSchema = z
  .object({
    memberId: MemberIdSchema,
    displayName: z.string().nullable(),
    rank: z.enum(['CIVILIAN', 'CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF']),
    rscSeniority: z.number().int().nonnegative(),
    rankSeniority: z.number().int().nonnegative().nullable(),
  })
  .strict();

/**
 * A captured name is returned only for a member explicitly named by a saved
 * filter exception. It lets the administrator review an inclusion or
 * exclusion without having to translate an internal member id. The server
 * still resolves membership from its one captured Department evaluation.
 */
const PreviewExceptionMemberSchema = z
  .object({ memberId: MemberIdSchema, displayName: z.string().nullable() })
  .strict();

const DefinitionIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('LEGACY_SOURCE'), sourceToken: DigestSchema }).strict(),
  z
    .object({
      kind: z.literal('VERSION'),
      versionId: IdentitySchema,
      revision: z.number().int().positive(),
      contentSha256: DigestSchema,
    })
    .strict(),
]);

const OrderingAuthoritySchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('RESOLVED'),
      request: BidOrderingAuthorityRequestSchema,
      authority: FrozenBidOrderingAuthoritySchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('UNRESOLVED'),
      request: BidOrderingAuthorityRequestSchema.nullable(),
      code: z.enum([
        'ordering_authority_unconfigured',
        'ordering_authority_source_decision_missing',
        'ordering_authority_source_decision_unresolved',
        'ordering_authority_comparator_mismatch',
      ]),
    })
    .strict(),
]);

const MembershipSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('RESOLVED_FOR_PREVIEW') }).strict(),
  z
    .object({
      status: z.literal('BLOCKED'),
      code: z.string(),
      stageId: z.string().trim().min(1).max(80).nullable(),
      memberIds: z.array(MemberIdSchema),
    })
    .strict(),
]);

const StageSchema = z
  .object({
    stageId: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    order: z.number().int().nonnegative(),
    source: z
      .object({
        sourceRef: z.string().trim().min(4).max(500),
        participantSource: StageParticipantSourceSchema,
        ordering: StageParticipantOrderingSchema,
      })
      .strict(),
    matchedMemberIds: z.array(MemberIdSchema).min(1),
    /** This sequence is presentation-only and can never be used as Bid order. */
    displayOrder: z.literal('MEMBER_ID_ASC'),
    matchedMembers: z.array(PreviewMemberSchema).min(1),
    exceptionMembers: z.array(PreviewExceptionMemberSchema).max(20_000).optional(),
  })
  .strict()
  .superRefine((stage, context) => {
    const ids = stage.matchedMembers.map((member) => member.memberId);
    if (JSON.stringify(ids) !== JSON.stringify(stage.matchedMemberIds))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['matchedMemberIds'],
        message: 'matched member ids must exactly describe the server-provided display sequence',
      });
    for (let index = 1; index < stage.matchedMemberIds.length; index += 1) {
      const prior = stage.matchedMemberIds[index - 1];
      const current = stage.matchedMemberIds[index];
      if (prior === undefined || current === undefined || prior < current) continue;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['matchedMemberIds', index],
        message: 'MEMBER_ID_ASC display order requires strictly increasing member ids',
      });
    }
    const exceptionIds = stage.exceptionMembers?.map((member) => member.memberId) ?? [];
    for (let index = 1; index < exceptionIds.length; index += 1) {
      const prior = exceptionIds[index - 1];
      const current = exceptionIds[index];
      if (prior === undefined || current === undefined || prior < current) continue;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exceptionMembers', index],
        message: 'named filter exceptions must have strictly increasing member ids',
      });
    }
  });

const IssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])),
    code: z.string(),
    message: z.string(),
  })
  .strict();

const ValidPreviewSchema = z
  .object({
    valid: z.literal(true),
    v: z.literal(1),
    bidYear: z.number().int().min(2024).max(2100),
    definition: DefinitionIdentitySchema,
    source: z
      .object({
        kind: z.enum(['RESTORE_CANDIDATE', 'UNSAVED_DRAFT']),
        baselineContentSha256: DigestSchema,
        candidateContentSha256: DigestSchema,
      })
      .strict(),
    capturedAtMs: z.number().int().nonnegative(),
    runtimeSourceToken: DigestSchema,
    contextSha256: DigestSchema,
    participantPreviewSha256: DigestSchema,
    orderingAuthority: OrderingAuthoritySchema,
    membership: MembershipSchema,
    stages: z.array(StageSchema),
    executionReady: z.boolean(),
    executionIssues: z.array(z.string()),
  })
  .strict()
  .superRefine((preview, context) => {
    const membershipResolved = preview.membership.status === 'RESOLVED_FOR_PREVIEW';
    const authorityResolved = preview.orderingAuthority.status === 'RESOLVED';
    const expectedReady =
      membershipResolved && authorityResolved && preview.executionIssues.length === 0;
    if (preview.executionReady !== expectedReady)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionReady'],
        message:
          'execution readiness must remain false unless membership and authority both resolve without issues',
      });
    if (!preview.executionReady && preview.executionIssues.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionIssues'],
        message: 'a non-ready participant preview requires an explicit blocking reason',
      });
    if (preview.membership.status === 'BLOCKED') {
      if (preview.stages.length > 0)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages'],
          message: 'blocked membership cannot expose a partial candidate set',
        });
      if (!preview.executionIssues.includes(preview.membership.code))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['executionIssues'],
          message: 'blocked membership must be represented in execution issues',
        });
    } else if (preview.stages.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages'],
        message: 'resolved typed membership requires at least one stage result',
      });
    }
    if (
      preview.orderingAuthority.status === 'UNRESOLVED' &&
      !preview.executionIssues.includes(preview.orderingAuthority.code)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionIssues'],
        message: 'unresolved ordering authority must be represented in execution issues',
      });
    const stageIds = new Set<string>();
    const memberIds = new Set<number>();
    for (const [stageIndex, stage] of preview.stages.entries()) {
      if (stageIds.has(stage.stageId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', stageIndex, 'stageId'],
          message: 'participant preview stage ids must be unique',
        });
      stageIds.add(stage.stageId);
      for (const memberId of stage.matchedMemberIds) {
        if (memberIds.has(memberId))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stages', stageIndex, 'matchedMemberIds'],
            message: 'a preview participant may appear in only one stage',
          });
        memberIds.add(memberId);
      }
    }
  });

/**
 * A read-only, server-resolved membership inspection. It is intentionally
 * distinct from a frozen run-preparation artifact: membership can resolve
 * while the governing ordering authority remains unresolved.
 */
export const BidStageParticipantPreviewResponseSchema = z.union([
  z.object({ valid: z.literal(false), issues: z.array(IssueSchema) }).strict(),
  ValidPreviewSchema,
]);

export type BidStageParticipantPreviewResponse = z.infer<
  typeof BidStageParticipantPreviewResponseSchema
>;
