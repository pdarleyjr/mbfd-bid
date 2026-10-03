import { z } from 'zod';

/** Operator review is an audit acknowledgement, never a source resolution or
 * a qualification approval. The digest binds the exact frozen run context. */
export const BidLaunchAdvisorySchema = z
  .object({
    id: z.string().min(1).max(200),
    code: z.string().min(1).max(200),
    detail: z.string().min(1).max(4000),
    affectedCount: z.number().int().positive().optional(),
  })
  .strict();

export const BidLaunchReviewSchema = z
  .object({
    advisorySha256: z.string().regex(/^[0-9a-f]{64}$/),
    requiresAcknowledgement: z.boolean(),
    advisories: z.array(BidLaunchAdvisorySchema).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.requiresAcknowledgement !== value.advisories.length > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiresAcknowledgement'],
        message: 'Acknowledgement must match the presence of launch advisories.',
      });
  });

export const BidLaunchAcknowledgementSchema = z
  .object({
    advisorySha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const BidStartSchema = z
  .object({
    launchAcknowledgement: BidLaunchAcknowledgementSchema.optional(),
  })
  .strict();

export type BidLaunchAdvisory = z.infer<typeof BidLaunchAdvisorySchema>;
export type BidLaunchReview = z.infer<typeof BidLaunchReviewSchema>;
export type BidLaunchAcknowledgement = z.infer<typeof BidLaunchAcknowledgementSchema>;
