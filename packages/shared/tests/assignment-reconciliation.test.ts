import { describe, expect, it } from 'vitest';
import {
  AssignmentReconciliationRowSchema,
  TeleStaffReconciliationItemSchema,
  summarizeAssignmentReconciliation,
  summarizeTeleStaffReconciliation,
} from '../src/assignment-reconciliation.js';

describe('TeleStaff assignment reconciliation contract', () => {
  // As a Bid administrator, I want every staged source row accounted for before
  // approval, so that unknown employees and ambiguous mappings cannot become
  // current assignments by accident.
  it('counts every required reconciliation disposition without dropping rows', () => {
    const summary = summarizeAssignmentReconciliation([
      { sourceRowNumber: 1, disposition: 'unchanged', reviewStatus: 'not_required' },
      {
        sourceRowNumber: 2,
        disposition: 'moved',
        reviewStatus: 'approved',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic move reviewed',
      },
      {
        sourceRowNumber: 3,
        disposition: 'new_combination',
        reviewStatus: 'rejected',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic new combination rejected',
      },
      {
        sourceRowNumber: 4,
        disposition: 'missing_vanished',
        reviewStatus: 'approved',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic missing row reviewed',
      },
      { sourceRowNumber: 5, disposition: 'unknown_employee', reviewStatus: 'pending' },
      { sourceRowNumber: 6, disposition: 'ambiguous_mapping', reviewStatus: 'pending' },
    ]);

    expect(summary.total).toBe(6);
    expect(summary.counts).toEqual({
      unchanged: 1,
      moved: 1,
      new_combination: 1,
      missing_vanished: 1,
      unknown_employee: 1,
      ambiguous_mapping: 1,
    });
    expect(summary.blockingDispositions).toEqual(['unknown_employee', 'ambiguous_mapping']);
    expect(summary.pendingReviewRowNumbers).toEqual([]);
    expect(summary.canCommit).toBe(false);
  });

  it('fails closed while a review-required source change lacks an explicit human disposition', () => {
    const summary = summarizeAssignmentReconciliation([
      { sourceRowNumber: 1, disposition: 'unchanged', reviewStatus: 'not_required' },
      { sourceRowNumber: 2, disposition: 'moved', reviewStatus: 'pending' },
      { sourceRowNumber: 3, disposition: 'new_combination', reviewStatus: 'pending' },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.blockingDispositions).toEqual([]);
    expect(summary.pendingReviewRowNumbers).toEqual([2, 3]);
    expect(summary.canCommit).toBe(false);
  });

  it('permits commit only after every review-required row records an explicit human disposition', () => {
    const summary = summarizeAssignmentReconciliation([
      { sourceRowNumber: 1, disposition: 'unchanged', reviewStatus: 'not_required' },
      {
        sourceRowNumber: 2,
        disposition: 'moved',
        reviewStatus: 'approved',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic move reviewed',
      },
      {
        sourceRowNumber: 3,
        disposition: 'new_combination',
        reviewStatus: 'rejected',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic source label rejected',
      },
      {
        sourceRowNumber: 4,
        disposition: 'missing_vanished',
        reviewStatus: 'approved',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic missing row reviewed',
      },
    ]);

    expect(summary.pendingReviewRowNumbers).toEqual([]);
    expect(summary.canCommit).toBe(true);
  });

  it('rejects unrecognized dispositions, invalid row numbers, and review dispositions without reviewer evidence', () => {
    expect(
      AssignmentReconciliationRowSchema.safeParse({
        sourceRowNumber: 0,
        disposition: 'auto_assign_employee',
      }).success,
    ).toBe(false);
    expect(
      AssignmentReconciliationRowSchema.safeParse({
        sourceRowNumber: 1,
        disposition: 'moved',
        reviewStatus: 'approved',
      }).success,
    ).toBe(false);
  });

  it('accounts for the seven operator-facing TeleStaff classifications without reinterpreting legacy dispositions', () => {
    const summary = summarizeTeleStaffReconciliation([
      {
        id: 'row-unchanged',
        sourceRowNumber: 1,
        classification: 'UNCHANGED',
        reviewStatus: 'not_required',
      },
      {
        id: 'row-moved',
        sourceRowNumber: 2,
        classification: 'MOVED',
        reviewStatus: 'approved',
        resolutionAction: 'APPLY_OBSERVATION',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic move approved.',
      },
      {
        id: 'row-new-assignment',
        sourceRowNumber: 3,
        classification: 'NEW_ASSIGNMENT',
        reviewStatus: 'rejected',
        resolutionAction: 'REJECT_SOURCE_ROW',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic new assignment rejected.',
      },
      {
        id: 'row-new-position',
        sourceRowNumber: 4,
        classification: 'NEW_POSITION',
        reviewStatus: 'approved',
        resolutionAction: 'DEFER_NEW_POSITION',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic source position deferred for baseline review.',
      },
      {
        id: 'missing-observation',
        classification: 'MISSING_OBSERVATION',
        reviewStatus: 'approved',
        resolutionAction: 'RETAIN_ASSIGNMENT',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic negative evidence reviewed without deleting capacity.',
      },
    ]);

    expect(summary.counts).toEqual({
      UNCHANGED: 1,
      MOVED: 1,
      NEW_ASSIGNMENT: 1,
      NEW_POSITION: 1,
      MISSING_OBSERVATION: 1,
      UNKNOWN_EMPLOYEE: 0,
      AMBIGUOUS_MAPPING: 0,
    });
    expect(summary.pendingReviewIds).toEqual([]);
    expect(summary.blockingClassifications).toEqual([]);
    expect(summary.canApply).toBe(true);
  });

  it('fails closed for unknown or ambiguous personnel/mapping evidence even after a reviewer records an outcome', () => {
    const summary = summarizeTeleStaffReconciliation([
      {
        id: 'unknown-employee',
        sourceRowNumber: 1,
        classification: 'UNKNOWN_EMPLOYEE',
        reviewStatus: 'rejected',
        resolutionAction: 'REJECT_SOURCE_ROW',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic identity could not be resolved.',
      },
      {
        id: 'ambiguous-mapping',
        sourceRowNumber: 2,
        classification: 'AMBIGUOUS_MAPPING',
        reviewStatus: 'rejected',
        resolutionAction: 'REJECT_SOURCE_ROW',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic slot mapping remains ambiguous.',
      },
    ]);

    expect(summary.blockingClassifications).toEqual(['UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING']);
    expect(summary.canApply).toBe(false);
  });

  it('requires explicit, compatible review actions before a classified item can apply', () => {
    expect(
      TeleStaffReconciliationItemSchema.safeParse({
        id: 'missing-with-source-row',
        sourceRowNumber: 1,
        classification: 'MISSING_OBSERVATION',
        reviewStatus: 'pending',
      }).success,
    ).toBe(false);
    expect(
      TeleStaffReconciliationItemSchema.safeParse({
        id: 'new-position-auto-create',
        sourceRowNumber: 1,
        classification: 'NEW_POSITION',
        reviewStatus: 'approved',
        resolutionAction: 'APPLY_OBSERVATION',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic invalid auto-create.',
      }).success,
    ).toBe(false);
    expect(
      TeleStaffReconciliationItemSchema.safeParse({
        id: 'moved-without-review-action',
        sourceRowNumber: 1,
        classification: 'MOVED',
        reviewStatus: 'approved',
        reviewerMemberId: 7,
        reviewedAt: 1,
        resolutionReason: 'Synthetic move missing explicit action.',
      }).success,
    ).toBe(false);
  });
});
