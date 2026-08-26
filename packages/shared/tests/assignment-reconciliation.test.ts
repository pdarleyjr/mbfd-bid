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
      { sourceRowNumber: 1, disposition: 'unchanged' },
      { sourceRowNumber: 2, disposition: 'moved' },
      { sourceRowNumber: 3, disposition: 'new_combination' },
      { sourceRowNumber: 4, disposition: 'missing_vanished' },
      { sourceRowNumber: 5, disposition: 'unknown_employee' },
      { sourceRowNumber: 6, disposition: 'ambiguous_mapping' },
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
    expect(summary.canCommit).toBe(false);
  });

  it('permits human approval only after every row has a non-blocking disposition', () => {
    const summary = summarizeAssignmentReconciliation([
      { sourceRowNumber: 1, disposition: 'unchanged' },
      { sourceRowNumber: 2, disposition: 'moved' },
      { sourceRowNumber: 3, disposition: 'new_combination' },
      { sourceRowNumber: 4, disposition: 'missing_vanished' },
    ]);

    expect(summary.total).toBe(4);
    expect(summary.blockingDispositions).toEqual([]);
    expect(summary.canCommit).toBe(true);
  });

  it('rejects an unrecognized disposition and non-positive source row number', () => {
    expect(
      AssignmentReconciliationRowSchema.safeParse({
        sourceRowNumber: 0,
        disposition: 'auto_assign_employee',
      }).success,
    ).toBe(false);
  });
});
