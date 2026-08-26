import { z } from 'zod';

/**
 * A source row is classified before any member assignment is created. The
 * values deliberately describe reconciliation outcomes, not policy rules.
 */
export const AssignmentReconciliationDispositionSchema = z.enum([
  'unchanged',
  'moved',
  'new_combination',
  'missing_vanished',
  'unknown_employee',
  'ambiguous_mapping',
]);

export type AssignmentReconciliationDisposition = z.infer<
  typeof AssignmentReconciliationDispositionSchema
>;

export const AssignmentReviewStatusSchema = z.enum([
  'not_required',
  'pending',
  'approved',
  'rejected',
]);

export type AssignmentReviewStatus = z.infer<typeof AssignmentReviewStatusSchema>;

const REVIEW_REQUIRED_DISPOSITIONS = ['moved', 'new_combination', 'missing_vanished'] as const;
const BLOCKING_DISPOSITIONS = ['unknown_employee', 'ambiguous_mapping'] as const;
const EXPLICIT_REVIEW_STATUSES = ['approved', 'rejected'] as const;

function isReviewRequired(
  disposition: AssignmentReconciliationDisposition,
): disposition is (typeof REVIEW_REQUIRED_DISPOSITIONS)[number] {
  return REVIEW_REQUIRED_DISPOSITIONS.includes(
    disposition as (typeof REVIEW_REQUIRED_DISPOSITIONS)[number],
  );
}

function hasExplicitHumanDisposition(status: AssignmentReviewStatus): boolean {
  return EXPLICIT_REVIEW_STATUSES.includes(status as (typeof EXPLICIT_REVIEW_STATUSES)[number]);
}

/**
 * This contract contains no employee names, identifiers, or source values.
 * Callers keep raw TeleStaff material outside the repository and store only
 * source references/fingerprints in the Worker database.
 */
export const AssignmentReconciliationRowSchema = z
  .object({
    sourceRowNumber: z.number().int().positive(),
    disposition: AssignmentReconciliationDispositionSchema,
    reviewStatus: AssignmentReviewStatusSchema,
    reviewerMemberId: z.number().int().positive().optional(),
    reviewedAt: z.number().int().nonnegative().optional(),
    resolutionReason: z.string().trim().min(1).max(1024).optional(),
  })
  .superRefine((row, ctx) => {
    const explicitReview = hasExplicitHumanDisposition(row.reviewStatus);
    const reviewEvidencePresent =
      row.reviewerMemberId !== undefined ||
      row.reviewedAt !== undefined ||
      row.resolutionReason !== undefined;

    if (isReviewRequired(row.disposition) && row.reviewStatus === 'not_required') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Review-required reconciliation rows cannot be marked not_required.',
        path: ['reviewStatus'],
      });
    }

    if (explicitReview) {
      if (row.reviewerMemberId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An explicit review disposition requires an internal reviewer reference.',
          path: ['reviewerMemberId'],
        });
      }
      if (row.reviewedAt === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An explicit review disposition requires a review timestamp.',
          path: ['reviewedAt'],
        });
      }
      if (row.resolutionReason === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An explicit review disposition requires a resolution reason.',
          path: ['resolutionReason'],
        });
      }
      return;
    }

    if (reviewEvidencePresent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reviewer evidence is valid only with an explicit review disposition.',
      });
    }
  });

export type AssignmentReconciliationRow = z.infer<typeof AssignmentReconciliationRowSchema>;

export interface AssignmentReconciliationSummary {
  total: number;
  counts: Readonly<Record<AssignmentReconciliationDisposition, number>>;
  blockingDispositions: readonly AssignmentReconciliationDisposition[];
  reviewRequiredDispositions: readonly AssignmentReconciliationDisposition[];
  pendingReviewRowNumbers: readonly number[];
  canCommit: boolean;
}

const DISPOSITIONS = AssignmentReconciliationDispositionSchema.options;

/**
 * Produces complete, deterministic reconciliation accounting. Blocking rows
 * always prevent commit. Review-required changes must have an explicit human
 * approval or rejection before a commit service may proceed.
 */
export function summarizeAssignmentReconciliation(
  rows: readonly AssignmentReconciliationRow[],
): AssignmentReconciliationSummary {
  const validatedRows = rows.map((row) => AssignmentReconciliationRowSchema.parse(row));
  const counts: Record<AssignmentReconciliationDisposition, number> = {
    unchanged: 0,
    moved: 0,
    new_combination: 0,
    missing_vanished: 0,
    unknown_employee: 0,
    ambiguous_mapping: 0,
  };

  for (const row of validatedRows) {
    counts[row.disposition] += 1;
  }

  const blockingDispositions = DISPOSITIONS.filter(
    (disposition): disposition is (typeof BLOCKING_DISPOSITIONS)[number] =>
      BLOCKING_DISPOSITIONS.includes(disposition as (typeof BLOCKING_DISPOSITIONS)[number]) &&
      counts[disposition] > 0,
  );
  const reviewRequiredDispositions = DISPOSITIONS.filter(
    (disposition): disposition is (typeof REVIEW_REQUIRED_DISPOSITIONS)[number] =>
      isReviewRequired(disposition) && counts[disposition] > 0,
  );
  const pendingReviewRowNumbers = validatedRows
    .filter(
      (row) => isReviewRequired(row.disposition) && !hasExplicitHumanDisposition(row.reviewStatus),
    )
    .map((row) => row.sourceRowNumber);

  return {
    total: validatedRows.length,
    counts,
    blockingDispositions,
    reviewRequiredDispositions,
    pendingReviewRowNumbers,
    canCommit: blockingDispositions.length === 0 && pendingReviewRowNumbers.length === 0,
  };
}
