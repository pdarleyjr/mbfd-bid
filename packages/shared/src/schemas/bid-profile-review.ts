import { z } from 'zod';
import { AnnualRuleScopeSchema } from './annual-rule-profile.js';
import {
  BidDefinitionContentSchema,
  BidDefinitionProvenanceSchema,
  BidDefinitionRuleSchema,
} from './bid-definition.js';

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const IdentitySchema = z.string().trim().min(1).max(200);
const CountSchema = z.number().int().nonnegative();
const IssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])),
    code: z.string(),
    message: z.string(),
  })
  .strict();
const SourceSchema = z
  .object({
    kind: z.enum(['RESTORE_CANDIDATE', 'UNSAVED_DRAFT']),
    baselineContentSha256: DigestSchema,
    candidateContentSha256: DigestSchema,
  })
  .strict();
const ProfileMappingSchema = z
  .object({
    id: IdentitySchema,
    name: IdentitySchema,
    sourceRef: z.string().trim().min(4).max(500),
    scope: AnnualRuleScopeSchema,
    /** Explicit server-derived membership; family names never infer membership. */
    positionIds: z.array(IdentitySchema),
  })
  .strict();
const ConflictSchema = z
  .object({
    positionId: IdentitySchema,
    field: z.string().min(1),
    profileIds: z.array(IdentitySchema),
    reason: z.string().min(1),
  })
  .strict();
const SelectionConsequencesSchema = z
  .object({
    status: z.literal('REQUIRES_SELECTION_CONTEXT'),
    areas: z.array(
      z.enum(['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS']),
    ),
  })
  .strict();
const MaterializedSchema = z
  .object({
    content: BidDefinitionContentSchema,
    contentSha256: DigestSchema,
    compiled: z.array(
      z
        .object({ rule: BidDefinitionRuleSchema, provenance: BidDefinitionProvenanceSchema })
        .strict(),
    ),
  })
  .strict();
const ImpactSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('UNAVAILABLE'), code: z.string().min(1) }).strict(),
  z
    .object({
      status: z.literal('EVALUATED'),
      contextSha256: DigestSchema,
      evaluatedComparisonCount: CountSchema,
    })
    .strict(),
]);
const SummarySchema = z
  .object({
    affectedPositionIds: z.array(IdentitySchema),
    affectedPositionCount: CountSchema,
    eligibilityChangeCount: CountSchema.nullable(),
    scoringChangeCount: CountSchema.nullable(),
    relativePriorityChangeCount: CountSchema.nullable(),
    impact: ImpactSchema,
    selectionConsequences: SelectionConsequencesSchema,
  })
  .strict();

/** Server-only profile compilation/review result. It carries the immutable
 * concrete candidate and evidence needed to review it; it grants no save,
 * publication, session, selection, or comparator authority. */
export const BidProfileReviewResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      valid: z.literal(false),
      kind: z.literal('INVALID_CANDIDATE'),
      issues: z.array(IssueSchema),
    })
    .strict(),
  z
    .object({
      valid: z.literal(false),
      kind: z.literal('PROFILE_AUTHORING_UNAVAILABLE'),
      code: z.string().min(1),
    })
    .strict(),
  z
    .object({
      valid: z.literal(false),
      kind: z.literal('PROFILE_COMPILATION_CONFLICT'),
      v: z.literal(1),
      bidYear: z.number().int().min(2024).max(2100),
      source: SourceSchema,
      capturedAtMs: CountSchema,
      runtimeSourceToken: DigestSchema,
      profileMappings: z.array(ProfileMappingSchema),
      conflicts: z.array(ConflictSchema).min(1),
    })
    .strict(),
  z
    .object({
      valid: z.literal(true),
      kind: z.literal('MATERIALIZED'),
      v: z.literal(1),
      bidYear: z.number().int().min(2024).max(2100),
      source: SourceSchema,
      capturedAtMs: CountSchema,
      runtimeSourceToken: DigestSchema,
      reviewSha256: DigestSchema,
      profileMappings: z.array(ProfileMappingSchema),
      materialized: MaterializedSchema,
      summary: SummarySchema,
    })
    .strict(),
]);
export type BidProfileReviewResponse = z.infer<typeof BidProfileReviewResponseSchema>;
