import { z } from 'zod';

/**
 * A deliberately non-operational policy envelope used to exercise the generic
 * specialty engine in staging. It is persisted only with the synthetic mock
 * scenario and is never a substitute for approved MBFD specialty policy.
 */
export const SPECIALTY_TEST_POLICY_LABEL = 'TEST POLICY — NOT APPROVED MBFD POLICY' as const;

const OpaqueIdSchema = z.string().trim().min(1).max(160);
const TieBreakSchema = z.enum(['rsc_seniority', 'rank_seniority', 'member_id']);
const CandidateOutcomeSchema = z.enum(['award', 'declined', 'unavailable']);

export const SpecialtyTestPolicySchema = z
  .object({
    policy_label: z.literal(SPECIALTY_TEST_POLICY_LABEL),
    policy_version: OpaqueIdSchema,
    specialty_pool: z
      .object({
        id: OpaqueIdSchema,
        label: z.string().trim().min(1).max(200),
      })
      .strict(),
    qualification_requirements: z.array(OpaqueIdSchema).min(1).max(30),
    ranking: z
      .object({
        source: z.literal('EXPLICIT_TEST_PRIORITY'),
        reference: OpaqueIdSchema,
      })
      .strict(),
    tie_break_chain: z.array(TieBreakSchema).min(2).max(3),
    normal_bid_interruption: z.literal('SUSPEND_EXACT_NORMAL_TURN'),
    candidate_outcomes: z.array(CandidateOutcomeSchema).min(3).max(3),
    original_bidder_resume: z.literal('RESUME_EXACT_ORIGINAL_TURN'),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      new Set(policy.qualification_requirements).size !== policy.qualification_requirements.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['qualification_requirements'],
        message: 'qualification requirements must be unique',
      });
    }
    if (new Set(policy.tie_break_chain).size !== policy.tie_break_chain.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tie_break_chain'],
        message: 'tie-break chain entries must be unique',
      });
    }
    const outcomes = new Set(policy.candidate_outcomes);
    for (const outcome of ['award', 'declined', 'unavailable'] as const) {
      if (!outcomes.has(outcome)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['candidate_outcomes'],
          message: `candidate outcomes must include ${outcome}`,
        });
      }
    }
  });

export type SpecialtyTestPolicy = z.infer<typeof SpecialtyTestPolicySchema>;
