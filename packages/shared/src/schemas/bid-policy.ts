import { z } from 'zod';

/**
 * Controls whether a canonical staffing slot participates in ordinary Bid
 * selection. A staffing record may remain active while being outside Bid.
 */
export const BidParticipationSchema = z.enum(['BIDDABLE', 'ADMIN_ASSIGNED_NON_BIDDABLE']);
export type BidParticipation = z.infer<typeof BidParticipationSchema>;

export const FrozenBidPoolMemberSchema = z
  .object({
    memberId: z.number().int().positive(),
    pool: z.enum(['OFC', 'FF', 'EXCLUDED']),
    rscSeniority: z.number().int().nonnegative(),
    rankSeniority: z.number().int().nonnegative().nullable(),
    exclusionReason: z.enum(['ADMIN_ASSIGNED_NON_BIDDABLE', 'MEMBER_CATEGORY_EXCLUDED']).nullable(),
    authoritativeAssignmentId: z.string().min(1).nullable(),
  })
  .strict();
export type FrozenBidPoolMember = z.infer<typeof FrozenBidPoolMemberSchema>;

/**
 * Immutable session input captured before ordinary Bid initialization. It is
 * deliberately limited to normalized identifiers and ordering data; no source
 * system material or person names are persisted in the snapshot.
 */
export const BidSessionPolicySnapshotSchema = z
  .object({
    v: z.literal(1),
    ruleBookVersion: z.string().min(1),
    positionTemplateVersion: z.string().min(1),
    capturedAtMs: z.number().int().nonnegative(),
    members: z.array(FrozenBidPoolMemberSchema),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const seen = new Set<number>();
    for (const [index, member] of snapshot.members.entries()) {
      if (seen.has(member.memberId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'memberId'],
          message: 'memberId must occur once in a session policy snapshot',
        });
      }
      seen.add(member.memberId);
      if (member.pool === 'EXCLUDED' && member.exclusionReason === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'exclusionReason'],
          message: 'an excluded member must carry a deterministic exclusion reason',
        });
      }
      if (member.pool !== 'EXCLUDED' && member.exclusionReason !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'exclusionReason'],
          message: 'a Bid-pool member cannot carry an exclusion reason',
        });
      }
      if (
        member.exclusionReason === 'ADMIN_ASSIGNED_NON_BIDDABLE' &&
        member.authoritativeAssignmentId === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'authoritativeAssignmentId'],
          message: 'an administrative-assignment exclusion must identify its frozen assignment',
        });
      }
    }
  });
export type BidSessionPolicySnapshot = z.infer<typeof BidSessionPolicySnapshotSchema>;
