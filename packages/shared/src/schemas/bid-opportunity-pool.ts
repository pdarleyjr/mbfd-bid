import { z } from 'zod';

/** Explicit logical opportunity, with ordered concrete capacity reservations.
 * Slot order is policy material and must never be normalized as a set. */
export const BidOpportunityPoolSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    kind: z.enum(['STATION_POOL', 'FLOAT_POOL']),
    sourceRef: z.string().trim().min(4).max(500),
    sourceDecisionId: z.string().trim().min(1).max(160),
    positionIds: z.array(z.string().trim().min(1).max(160)).min(1).max(1000),
  })
  .strict()
  .superRefine((pool, context) => {
    if (new Set(pool.positionIds).size !== pool.positionIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['positionIds'],
        message: 'Pool capacity slots must be unique.',
      });
  });
export const BidOpportunityPoolsSchema = z
  .array(BidOpportunityPoolSchema)
  .max(100)
  .superRefine((pools, context) => {
    if (new Set(pools.map((pool) => pool.id)).size !== pools.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Pool identities must be unique.' });
    const slots = pools.flatMap((pool) => pool.positionIds);
    if (new Set(slots).size !== slots.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A capacity slot may belong to only one pool.',
      });
  });
export const BidPoolSelectionSchema = z
  .object({ poolId: z.string().trim().min(1).max(80) })
  .strict();
export type BidOpportunityPool = z.infer<typeof BidOpportunityPoolSchema>;
