import type { BidDefinitionContent, BidDefinitionIssue } from '@mbfd/shared';

type Decision = BidDefinitionContent['sourceDecisions'][number];
type ReviewableDecision = Pick<Decision, 'status'> &
  Partial<
    Pick<
      Decision,
      | 'title'
      | 'question'
      | 'decision'
      | 'sourceRef'
      | 'membershipPopulation'
      | 'blockingClassification'
      | 'affectedScopes'
    >
  >;

export type BidSourceDecisionPurpose = 'mock' | 'live' | 'participant_preview';

/** OPEN questions may be carried as explicit working assumptions only for a
 * Mock or participant preview when their saved classification says they block
 * Real activation and nothing earlier. Missing classifications remain
 * conservatively configuration-blocking. */
export function bidSourceDecisionBlocksPurpose(
  decision: ReviewableDecision,
  purpose: BidSourceDecisionPurpose,
) {
  if (decision.status !== 'OPEN') return false;
  if (purpose === 'live') return true;
  return decision.blockingClassification !== 'BLOCKS_REAL_BID_ACTIVATION';
}

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
    if (decision.blockingClassification && !decision.affectedScopes?.length)
      issues.push({
        path: ['sourceDecisions', index, 'affectedScopes'],
        code: 'source_decision_scope_required',
        message: 'A classified source decision must identify its affected scopes.',
      });
    if (
      decision.membershipPopulation &&
      (decision.status === 'RESOLVED') === (decision.membershipPopulation.choice === 'UNRESOLVED')
    )
      issues.push({
        path: ['sourceDecisions', index, 'membershipPopulation'],
        code: 'membership_population_resolution_mismatch',
        message: 'The typed population choice must agree with the source decision status.',
      });
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

/** A scoped operational decision never stands in for a software release gate.
 * Unclassified historical OPEN decisions remain conservatively configuration-blocking. */
export function bidSourceDecisionBlockers(
  decisions: readonly (ReviewableDecision & { issueId: string })[],
) {
  return decisions
    .filter((decision) => decision.status === 'OPEN')
    .map((decision) => ({
      issueId: decision.issueId,
      classification: decision.blockingClassification ?? 'BLOCKS_FINAL_2026_CONFIGURATION',
      affectedScopes: decision.affectedScopes ?? ['annual-policy'],
    }));
}
