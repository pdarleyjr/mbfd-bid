import type { BidDefinitionContent, BidDefinitionIssue } from '@mbfd/shared';
import { bidSourceDecisionReviewIssues } from './bid-source-decision-review.js';

/** Save permits incomplete drafts. Check actual FK dependencies separately
 * from runtime eligibility/readiness so an absent staffing ID is repairable. */
export async function bidDefinitionReferenceIssues(
  database: D1Database,
  content: BidDefinitionContent,
) {
  const issues: BidDefinitionIssue[] = bidSourceDecisionReviewIssues(content.sourceDecisions);
  for (const distribution of content.policy?.executionPolicy.annualOperations
    ?.membershipDistributions ?? []) {
    if (distribution.membershipSource !== 'REVIEWED_QUALIFIED_POOL') continue;
    const decision = content.sourceDecisions.find(
      (entry) => entry.issueId === distribution.sourceDecisionId,
    );
    if (
      !decision?.membershipPopulation ||
      decision.membershipPopulation.distributionId !== distribution.id
    )
      issues.push({
        path: ['policy', 'executionPolicy', 'annualOperations', 'membershipDistributions'],
        code: 'membership_population_source_required',
        message:
          'A wider membership pool requires a typed source decision naming this distribution.',
      });
  }
  for (const [index, decision] of content.sourceDecisions.entries()) {
    const population = decision.membershipPopulation;
    if (!population || population.choice === 'UNRESOLVED') continue;
    const distribution =
      content.policy?.executionPolicy.annualOperations?.membershipDistributions?.find(
        (entry) => entry.id === population.distributionId,
      );
    const expected =
      population.choice === 'CURRENT_SIX' ? 'REVIEWED_EXISTING_MEMBERS' : 'REVIEWED_QUALIFIED_POOL';
    if (
      !distribution ||
      distribution.sourceDecisionId !== decision.issueId ||
      distribution.membershipSource !== expected ||
      (population.choice === 'CURRENT_SIX' && distribution.memberIds.length !== 6)
    )
      issues.push({
        path: ['sourceDecisions', index, 'membershipPopulation'],
        code: 'membership_population_configuration_mismatch',
        message: 'The reviewed population must match the configured membership distribution.',
      });
  }
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
