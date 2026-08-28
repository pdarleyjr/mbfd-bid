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

/**
 * Operator-facing TeleStaff reconciliation labels. These intentionally remain
 * separate from the legacy persisted `disposition` values above: in
 * particular, `new_combination` cannot be retroactively guessed to mean a new
 * assignment or a new staffing position.
 */
export const TeleStaffReconciliationClassificationSchema = z.enum([
  'UNCHANGED',
  'MOVED',
  'NEW_ASSIGNMENT',
  'NEW_POSITION',
  'MISSING_OBSERVATION',
  'UNKNOWN_EMPLOYEE',
  'AMBIGUOUS_MAPPING',
]);

export type TeleStaffReconciliationClassification = z.infer<
  typeof TeleStaffReconciliationClassificationSchema
>;

/**
 * A resolution must say what happened. It is not permission to create a slot,
 * publish an award, or mutate a portal; those remain separate server-side
 * controls.
 */
export const TeleStaffReconciliationResolutionActionSchema = z.enum([
  'APPLY_OBSERVATION',
  'DEFER_NEW_POSITION',
  'REJECT_SOURCE_ROW',
  'RETAIN_ASSIGNMENT',
  'END_ASSIGNMENT',
]);

export type TeleStaffReconciliationResolutionAction = z.infer<
  typeof TeleStaffReconciliationResolutionActionSchema
>;

const TELESTAFF_REVIEW_REQUIRED = [
  'MOVED',
  'NEW_ASSIGNMENT',
  'NEW_POSITION',
  'MISSING_OBSERVATION',
  'UNKNOWN_EMPLOYEE',
  'AMBIGUOUS_MAPPING',
] as const;

const TELESTAFF_HARD_BLOCKERS = ['UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING'] as const;

function requiresTeleStaffReview(
  classification: TeleStaffReconciliationClassification,
): classification is (typeof TELESTAFF_REVIEW_REQUIRED)[number] {
  return TELESTAFF_REVIEW_REQUIRED.includes(
    classification as (typeof TELESTAFF_REVIEW_REQUIRED)[number],
  );
}

function isTeleStaffHardBlocker(
  classification: TeleStaffReconciliationClassification,
): classification is (typeof TELESTAFF_HARD_BLOCKERS)[number] {
  return TELESTAFF_HARD_BLOCKERS.includes(
    classification as (typeof TELESTAFF_HARD_BLOCKERS)[number],
  );
}

function requiresReviewEvidence(status: AssignmentReviewStatus): boolean {
  return status === 'approved' || status === 'rejected';
}

function actionIsCompatible(
  classification: TeleStaffReconciliationClassification,
  reviewStatus: AssignmentReviewStatus,
  action: TeleStaffReconciliationResolutionAction,
): boolean {
  if (classification === 'MOVED' || classification === 'NEW_ASSIGNMENT') {
    return (
      (reviewStatus === 'approved' && action === 'APPLY_OBSERVATION') ||
      (reviewStatus === 'rejected' && action === 'REJECT_SOURCE_ROW')
    );
  }
  if (classification === 'NEW_POSITION') {
    return (
      (reviewStatus === 'approved' && action === 'DEFER_NEW_POSITION') ||
      (reviewStatus === 'rejected' && action === 'REJECT_SOURCE_ROW')
    );
  }
  if (classification === 'MISSING_OBSERVATION') {
    return (
      reviewStatus === 'approved' && (action === 'RETAIN_ASSIGNMENT' || action === 'END_ASSIGNMENT')
    );
  }
  if (classification === 'UNKNOWN_EMPLOYEE' || classification === 'AMBIGUOUS_MAPPING') {
    return reviewStatus === 'rejected' && action === 'REJECT_SOURCE_ROW';
  }
  return false;
}

/**
 * A v2 item can represent either a source row or a missing-observation
 * finding. Negative evidence deliberately has no source row number: adding a
 * fictional row would break import-manifest accounting.
 */
export const TeleStaffReconciliationItemSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    sourceRowNumber: z.number().int().positive().optional(),
    classification: TeleStaffReconciliationClassificationSchema,
    reviewStatus: AssignmentReviewStatusSchema,
    resolutionAction: TeleStaffReconciliationResolutionActionSchema.optional(),
    reviewerMemberId: z.number().int().positive().optional(),
    reviewedAt: z.number().int().nonnegative().optional(),
    resolutionReason: z.string().trim().min(1).max(1024).optional(),
  })
  .superRefine((item, ctx) => {
    const reviewEvidencePresent =
      item.reviewerMemberId !== undefined ||
      item.reviewedAt !== undefined ||
      item.resolutionReason !== undefined;

    if (item.classification === 'MISSING_OBSERVATION' && item.sourceRowNumber !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Missing observations are import-scoped findings, not source rows.',
        path: ['sourceRowNumber'],
      });
    }
    if (item.classification !== 'MISSING_OBSERVATION' && item.sourceRowNumber === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Source-row classifications require their original source row number.',
        path: ['sourceRowNumber'],
      });
    }

    if (item.classification === 'UNCHANGED') {
      if (item.reviewStatus !== 'not_required') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Unchanged source rows do not take a human review disposition.',
          path: ['reviewStatus'],
        });
      }
      if (item.resolutionAction !== undefined || reviewEvidencePresent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Unchanged source rows cannot carry a reconciliation action or review evidence.',
        });
      }
      return;
    }

    if (!requiresTeleStaffReview(item.classification)) return;
    if (item.reviewStatus === 'not_required') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'This TeleStaff classification requires an explicit review state.',
        path: ['reviewStatus'],
      });
      return;
    }

    if (!requiresReviewEvidence(item.reviewStatus)) {
      if (item.resolutionAction !== undefined || reviewEvidencePresent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Pending reconciliation review cannot carry a final action or reviewer evidence.',
        });
      }
      return;
    }

    if (
      item.reviewerMemberId === undefined ||
      item.reviewedAt === undefined ||
      item.resolutionReason === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A final reconciliation decision requires actor, timestamp, and reason.',
      });
    }
    if (item.resolutionAction === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A final reconciliation decision requires an explicit action.',
        path: ['resolutionAction'],
      });
    } else if (!actionIsCompatible(item.classification, item.reviewStatus, item.resolutionAction)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'The reconciliation action is incompatible with its classification and review state.',
        path: ['resolutionAction'],
      });
    }
  });

export type TeleStaffReconciliationItem = z.infer<typeof TeleStaffReconciliationItemSchema>;

export interface TeleStaffReconciliationSummary {
  total: number;
  counts: Readonly<Record<TeleStaffReconciliationClassification, number>>;
  blockingClassifications: readonly TeleStaffReconciliationClassification[];
  pendingReviewIds: readonly string[];
  canApply: boolean;
}

/**
 * Summarizes the new operator taxonomy. Unknown employees and ambiguous
 * mappings remain hard blockers even after a reviewer records a rejection;
 * resolving them requires a later, explicitly mapped import, never a
 * fail-open decision on this source evidence.
 */
export function summarizeTeleStaffReconciliation(
  items: readonly TeleStaffReconciliationItem[],
): TeleStaffReconciliationSummary {
  const validatedItems = items.map((item) => TeleStaffReconciliationItemSchema.parse(item));
  const counts: Record<TeleStaffReconciliationClassification, number> = {
    UNCHANGED: 0,
    MOVED: 0,
    NEW_ASSIGNMENT: 0,
    NEW_POSITION: 0,
    MISSING_OBSERVATION: 0,
    UNKNOWN_EMPLOYEE: 0,
    AMBIGUOUS_MAPPING: 0,
  };

  for (const item of validatedItems) {
    counts[item.classification] += 1;
  }

  const blockingClassifications = TeleStaffReconciliationClassificationSchema.options.filter(
    (classification): classification is (typeof TELESTAFF_HARD_BLOCKERS)[number] =>
      isTeleStaffHardBlocker(classification) && counts[classification] > 0,
  );
  const pendingReviewIds = validatedItems
    .filter(
      (item) => requiresTeleStaffReview(item.classification) && item.reviewStatus === 'pending',
    )
    .map((item) => item.id);

  return {
    total: validatedItems.length,
    counts,
    blockingClassifications,
    pendingReviewIds,
    canApply: blockingClassifications.length === 0 && pendingReviewIds.length === 0,
  };
}
