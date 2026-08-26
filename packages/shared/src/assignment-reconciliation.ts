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

/**
 * This contract contains no employee names, identifiers, or source values.
 * Callers keep raw TeleStaff material outside the repository and store only
 * source references/fingerprints in the Worker database.
 */
export const AssignmentReconciliationRowSchema = z.object({
  sourceRowNumber: z.number().int().positive(),
  disposition: AssignmentReconciliationDispositionSchema,
});

export type AssignmentReconciliationRow = z.infer<typeof AssignmentReconciliationRowSchema>;

export interface AssignmentReconciliationSummary {
  total: number;
  counts: Readonly<Record<AssignmentReconciliationDisposition, number>>;
  blockingDispositions: readonly AssignmentReconciliationDisposition[];
  canCommit: boolean;
}

const DISPOSITIONS = AssignmentReconciliationDispositionSchema.options;
const BLOCKING_DISPOSITIONS = ['unknown_employee', 'ambiguous_mapping'] as const;

/**
 * Produces complete, deterministic reconciliation accounting. Import callers
 * must request human approval before committing; this helper only establishes
 * whether unresolved identity/mapping rows still make approval unsafe.
 */
export function summarizeAssignmentReconciliation(
  rows: readonly AssignmentReconciliationRow[],
): AssignmentReconciliationSummary {
  const counts: Record<AssignmentReconciliationDisposition, number> = {
    unchanged: 0,
    moved: 0,
    new_combination: 0,
    missing_vanished: 0,
    unknown_employee: 0,
    ambiguous_mapping: 0,
  };

  for (const row of rows) {
    counts[row.disposition] += 1;
  }

  const blockingDispositions = DISPOSITIONS.filter(
    (disposition): disposition is (typeof BLOCKING_DISPOSITIONS)[number] =>
      BLOCKING_DISPOSITIONS.includes(disposition as (typeof BLOCKING_DISPOSITIONS)[number]) &&
      counts[disposition] > 0,
  );

  return {
    total: rows.length,
    counts,
    blockingDispositions,
    canCommit: blockingDispositions.length === 0,
  };
}
