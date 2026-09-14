import type { BidDefinitionContent, BidDefinitionIssue } from '@mbfd/shared';
import { bidSourceDecisionReviewIssues } from './bid-source-decision-review.js';

/** Save permits incomplete drafts. Check actual FK dependencies separately
 * from runtime eligibility/readiness so an absent staffing ID is repairable. */
export async function bidDefinitionReferenceIssues(
  database: D1Database,
  content: BidDefinitionContent,
) {
  const issues: BidDefinitionIssue[] = bidSourceDecisionReviewIssues(content.sourceDecisions);
  if (content.staffingBindings.length) {
    const found = await database
      .prepare(`SELECT id FROM staffing_positions WHERE id IN
      (SELECT json_extract(value,'$.staffingPositionId') FROM json_each(?))`)
      .bind(JSON.stringify(content.staffingBindings))
      .all<{ id: string }>();
    const known = new Set(found.results.map((row) => row.id));
    content.staffingBindings.forEach((binding, index) => {
      if (!known.has(binding.staffingPositionId))
        issues.push({
          path: ['staffingBindings', index, 'staffingPositionId'],
          code: 'staffing_position_not_found',
          message: `Staffing position ${binding.staffingPositionId} does not exist`,
        });
    });
  }
  return issues;
}
