import { z } from 'zod';
import {
  RULE_CUSTOM_CRITERIA,
  RULE_RANKS,
  RULE_TIE_BREAK_KEYS,
} from '../constants/rule-capabilities.js';
import { ConfiguredScoringSchema } from './configured-scoring.js';
import { PostAwardObligationsSchema } from './post-award-obligation.js';
import { QualificationAlternativesSchema } from './qualification-alternatives.js';
import { ServiceRequirementsSchema } from './service-evidence.js';

const Id = z.string().trim().min(1).max(160);
export const AnnualRuleScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('department') }).strict(),
  z.object({ kind: z.literal('rank'), rank: z.enum(RULE_RANKS) }).strict(),
  z
    .object({ kind: z.literal('station_shift'), station: Id, shift: z.enum(['A', 'B', 'C', 'D']) })
    .strict(),
  // Family membership is explicitly selected, never inferred from a display name.
  z
    .object({ kind: z.literal('family'), name: Id, positionIds: z.array(Id).min(1).max(500) })
    .strict(),
  z.object({ kind: z.literal('position'), positionId: Id }).strict(),
]);
export const AnnualRuleProfileSchema = z
  .object({
    id: Id,
    name: Id,
    sourceRef: z.string().trim().min(4).max(500),
    scope: AnnualRuleScopeSchema,
    requirements: z
      .object({
        ranks: z.array(z.enum(RULE_RANKS)).min(1).max(6).optional(),
        credentials: z.array(Id).max(200),
        anyOfCredentials: QualificationAlternativesSchema.optional(),
        service: ServiceRequirementsSchema.optional(),
        postAward: PostAwardObligationsSchema.optional(),
        custom: z.array(z.enum(RULE_CUSTOM_CRITERIA)).max(3),
      })
      .strict(),
    scoring: ConfiguredScoringSchema.optional(),
    tieBreakChain: z
      .array(z.enum(RULE_TIE_BREAK_KEYS))
      .min(1)
      .max(5)
      .refine((v) => new Set(v).size === v.length, 'Priority keys must be unique')
      .optional(),
  })
  .strict();
export const AnnualRuleProfilesSchema = z
  .array(AnnualRuleProfileSchema)
  .min(1)
  .max(250)
  .refine((v) => new Set(v.map((p) => p.id)).size === v.length, 'Profile IDs must be unique');
export type AnnualRuleProfile = z.infer<typeof AnnualRuleProfileSchema>;
