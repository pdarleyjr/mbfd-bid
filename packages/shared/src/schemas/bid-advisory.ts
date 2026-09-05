import { z } from 'zod';

export const BidAdvisoryKindSchema = z.enum([
  'bid_state',
  'candidate_order',
  'position_options',
  'specialty',
  'a_day',
  'annual_operations',
  'staffing_authority',
  'mock_boundary',
]);

export const BidAdvisorySeveritySchema = z.enum(['info', 'ready', 'attention', 'blocked']);

export const BidAdvisoryEvidenceSourceSchema = z.enum([
  'canonical_session_state',
  'frozen_policy_snapshot',
  'candidate_order_result',
  'selection_result',
  'eligibility_engine',
  'specialty_state',
  'a_day_engine',
  'annual_operations_state',
  'accepted_staffing_baseline',
  'mock_session_flag',
]);

export const BidAdvisoryCardSchema = z
  .object({
    kind: BidAdvisoryKindSchema,
    severity: BidAdvisorySeveritySchema,
    title: z.string().min(1).max(80),
    summary: z.string().min(1).max(500),
    sources: z.array(BidAdvisoryEvidenceSourceSchema).min(1).max(5),
  })
  .strict();

export const BidAdvisoryBundleSchema = z
  .object({
    v: z.literal(1),
    determinationSource: z.literal('authoritative_bid_state'),
    sessionId: z.string().min(1).max(128),
    sequence: z.number().int().nonnegative(),
    ruleBookVersion: z.string().min(1).max(128),
    positionTemplateVersion: z.string().min(1).max(128),
    configurationRevision: z.number().int().nonnegative(),
    cards: z.array(BidAdvisoryCardSchema).min(1).max(8),
  })
  .strict();

export type BidAdvisoryKind = z.infer<typeof BidAdvisoryKindSchema>;
export type BidAdvisorySeverity = z.infer<typeof BidAdvisorySeveritySchema>;
export type BidAdvisoryEvidenceSource = z.infer<typeof BidAdvisoryEvidenceSourceSchema>;
export type BidAdvisoryCard = z.infer<typeof BidAdvisoryCardSchema>;
export type BidAdvisoryBundle = z.infer<typeof BidAdvisoryBundleSchema>;
