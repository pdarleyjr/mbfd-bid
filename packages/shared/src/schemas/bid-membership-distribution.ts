import { z } from 'zod';

/** Reviewed memberships coexist with a station/shift award. They are not
 * apparatus seats and cannot create or replace an organizational assignment. */
export const BidMembershipDistributionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    sourceRef: z.string().trim().min(4).max(500),
    sourceDecisionId: z.string().trim().min(1).max(160),
    membershipSource: z.literal('REVIEWED_EXISTING_MEMBERS'),
    memberIds: z.array(z.number().int().positive()).min(1).max(1000),
    shifts: z.array(z.enum(['A', 'B', 'C'])).min(1),
    minimumPerShift: z.number().int().min(0).max(1000),
    maximumPerShift: z.number().int().min(1).max(1000),
    maximumPerADay: z.number().int().min(1).max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.memberIds).size !== value.memberIds.length ||
      new Set(value.shifts).size !== value.shifts.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Membership and shift entries must be unique',
      });
    if (
      value.minimumPerShift > value.maximumPerShift ||
      value.memberIds.length < value.shifts.length * value.minimumPerShift ||
      value.memberIds.length > value.shifts.length * value.maximumPerShift
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reviewed memberships must fit the configured shift distribution',
      });
  });

export type BidMembershipDistribution = z.infer<typeof BidMembershipDistributionSchema>;
