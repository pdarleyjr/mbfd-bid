import type { BidDefinitionContent, BidDefinitionIssue } from '@mbfd/shared';

type Decision = BidDefinitionContent['sourceDecisions'][number];
type ReviewableDecision = Pick<Decision, 'status'> &
  Partial<Pick<Decision, 'title' | 'question' | 'decision' | 'sourceRef'>>;

/** Preserve recorded content bytes and allow unfinished OPEN drafts. A resolved
 * decision must retain the evidence bounds of the existing source-review route.
 * Read/history parsing is deliberately separate from this admission check. */
export function bidSourceDecisionReviewIssues(decisions: readonly ReviewableDecision[]) {
  const issues: BidDefinitionIssue[] = [];
  const fields = [
    ['title', 'a title', 200],
    ['question', 'the source question', 3000],
    ['decision', 'the reviewed decision', 4000],
    ['sourceRef', 'a source reference', 1000],
  ] as const;
  decisions.forEach((decision, index) => {
    if (decision.status !== 'RESOLVED') return;
    for (const [field, label, maximum] of fields) {
      const length = decision[field]?.trim().length ?? 0;
      if (length < 4 || length > maximum)
        issues.push({
          path: ['sourceDecisions', index, field],
          code: 'complete_source_decision_required',
          message: `A resolved source decision requires ${label} with 4–${maximum} characters, excluding surrounding whitespace.`,
        });
    }
  });
  return issues;
}
