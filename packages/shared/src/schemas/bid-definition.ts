import { z } from 'zod';
import { AnnualRuleProfilesSchema } from './annual-rule-profile.js';
import {
  BidConfigurationSettingsSchema,
  BidOrderingComparatorSchema,
  BidParticipationSchema,
  CredentialEvaluationDateSchema,
  FrozenLiveBidPolicySchema,
  FrozenRuleBookPositionSchema,
  FrozenRuleBookRuleSchema,
  StageParticipantSourceDefinitionsSchema,
} from './bid-policy.js';

const Identity = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), 'Identifiers must not contain surrounding whitespace');
const Notes = z.string().nullable();

/** The existing Worker rule decoder is the authority for the three JSON columns.
 * Keeping its input format avoids a second rule language or a lossy conversion.
 * New internal book/template aliases are persistence metadata, not policy content. */
export const BidDefinitionRuleSchema = FrozenRuleBookRuleSchema.omit({
  ruleBookVersion: true,
  templateVersion: true,
}).extend({ positionId: Identity, notes: Notes });
export type BidDefinitionRule = z.infer<typeof BidDefinitionRuleSchema>;

export const BidDefinitionPositionSchema = FrozenRuleBookPositionSchema.omit({
  templateVersion: true,
  bidParticipation: true,
}).extend({
  id: Identity,
  division: FrozenRuleBookPositionSchema.shape.division.unwrap(),
  isFloating: z.boolean(),
  isVacantByDesign: z.boolean(),
});

export const BidDefinitionProvenanceSchema = z
  .object({
    requirements: z.array(Identity),
    scoring: z.array(Identity),
    priorities: z.array(Identity),
    matched: z.array(Identity),
  })
  .strict();

/** The absence of authoring material is explicit; it is never replaced by a
 * generated profile. Final advanced rules remain independent of a compilation. */
export const BidDefinitionAuthoringSchema = z
  .object({
    profiles: AnnualRuleProfilesSchema,
    compiled: z.array(
      z
        .object({
          rule: BidDefinitionRuleSchema,
          provenance: BidDefinitionProvenanceSchema,
        })
        .strict(),
    ),
    reconciliation: z.enum(['MATCHES_CAPTURED_RULE_REVISION', 'RULES_CHANGED_AFTER_COMPILATION']),
  })
  .strict();

/** Typed result recorded on the independently reviewed source decision. A
 * prose sourceRef or a requested enum selection cannot stand in for it. */
export const BidOrderingSourceDecisionResolutionSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('BID_ORDERING_COMPARATOR'),
    comparator: BidOrderingComparatorSchema,
  })
  .strict();
export type BidOrderingSourceDecisionResolution = z.infer<
  typeof BidOrderingSourceDecisionResolutionSchema
>;

/** Saved-definition request for a governing comparator. This pointer must
 * resolve to a separate RESOLVED annual-policy source decision before it is
 * copied into a frozen policy snapshot. */
export const BidOrderingAuthorityRequestSchema = z
  .object({
    v: z.literal(1),
    sourceDecisionId: Identity,
    comparator: BidOrderingComparatorSchema,
  })
  .strict();
export type BidOrderingAuthorityRequest = z.infer<typeof BidOrderingAuthorityRequestSchema>;

export const BidDefinitionSourceDecisionSchema = z
  .object({
    issueId: Identity,
    title: z.string(),
    question: z.string(),
    area: z.enum(['positions', 'rules', 'annual-policy', 'annual-plan']),
    status: z.enum(['OPEN', 'RESOLVED']),
    decision: z.string(),
    sourceRef: z.string(),
    effectiveOn: CredentialEvaluationDateSchema,
    resolution: BidOrderingSourceDecisionResolutionSchema.optional(),
  })
  .strict();
export type BidDefinitionSourceDecision = z.infer<typeof BidDefinitionSourceDecisionSchema>;

/** Typed policy material. Runtime members, credentials, assignments, baseline,
 * and clock-dependent readiness belong to the run context, never this hash.
 * Null/unconfigured and legacy V1 settings remain editable evidence; they do
 * not gain permission to create a run by being representable here. */
export const BidDefinitionContentSchema = z
  .object({
    v: z.literal(1),
    bidYear: z.number().int().min(2024).max(2100),
    settings: BidConfigurationSettingsSchema.nullable(),
    notes: z.object({ bid: Notes, positions: Notes }).strict(),
    policy: z
      .object({
        policyText: z.string(),
        executionPolicy: FrozenLiveBidPolicySchema,
        orderingAuthority: BidOrderingAuthorityRequestSchema.optional(),
        /** Optional preserves prior explicit-member definitions verbatim. */
        stageParticipantSources: StageParticipantSourceDefinitionsSchema.optional(),
      })
      .strict()
      .nullable(),
    planning: z
      .object({
        effectiveOn: CredentialEvaluationDateSchema,
        sourceSessionId: Identity.nullable(),
        sourcePolicyText: Notes,
      })
      .strict()
      .nullable(),
    authoring: BidDefinitionAuthoringSchema.nullable(),
    positions: z.array(BidDefinitionPositionSchema),
    rules: z.array(BidDefinitionRuleSchema),
    // Empty participation means the legacy implicit BIDDABLE behavior. It is
    // distinct from an explicit BIDDABLE row with reviewed source provenance.
    participation: z.array(
      z
        .object({
          positionId: Identity,
          bidParticipation: BidParticipationSchema,
          authoritativeSourceRef: z.string(),
        })
        .strict(),
    ),
    staffingBindings: z.array(
      z
        .object({
          positionId: Identity,
          staffingPositionId: Identity,
          authoritativeSourceRef: z.string(),
          reviewStatus: z.enum(['draft', 'approved', 'retired']),
        })
        .strict(),
    ),
    sourceDecisions: z.array(BidDefinitionSourceDecisionSchema),
  })
  .strict();
export type BidDefinitionContent = z.infer<typeof BidDefinitionContentSchema>;

export type BidDefinitionIssue = {
  path: (string | number)[];
  code: string;
  message: string;
};
