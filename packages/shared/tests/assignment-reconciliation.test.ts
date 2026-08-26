import { describe, expect, it } from 'vitest';
import {
  AssignmentReconciliationRowSchema,
  summarizeAssignmentReconciliation,
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
});
