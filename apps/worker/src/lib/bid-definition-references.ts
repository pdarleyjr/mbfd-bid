import type { BidDefinitionContent, BidDefinitionIssue } from '@mbfd/shared';
import { isFinal2026ManagedConfiguration } from './2026-opportunity-inventory.js';
import { definitionRuleBookMaterial } from './bid-definition-content.js';
import { evaluateRuleBookCoverage } from './bid-policy.js';
import { bidSourceDecisionReviewIssues } from './bid-source-decision-review.js';

/** Save permits incomplete drafts. Check actual FK dependencies separately
 * from runtime eligibility/readiness so an absent staffing ID is repairable. */
export async function bidDefinitionReferenceIssues(
  database: D1Database,
  content: BidDefinitionContent,
) {
  const issues: BidDefinitionIssue[] = bidSourceDecisionReviewIssues(content.sourceDecisions);
  if (
    isFinal2026ManagedConfiguration(content.bidYear, content.positions) &&
    content.rules.length > 0
  ) {
    const catalog = await database
      .prepare(`SELECT c.name FROM credentials c
        LEFT JOIN credential_catalog_metadata m ON m.credential_id = c.id
        WHERE m.retired_on IS NULL`)
      .all<{ name: string }>();
    const coverage = evaluateRuleBookCoverage({
      ...definitionRuleBookMaterial(content),
      ruleBookVersion: 'bid-definition-content-v1',
      declaredTemplateVersion: 'bid-definition-content-v1',
      credentialCatalogNames: catalog.results.map((row) => row.name),
      enforcePositionRank: true,
    });
    for (const positionId of coverage.rankMismatchPositionIds) {
      issues.push({
        path: ['rules'],
        code: 'rule_rank_position_mismatch',
        message: `Rule rank does not include the Bid rank of position ${positionId}`,
      });
    }
    for (const reference of coverage.unresolvedCredentialReferences) {
      issues.push({
        path: ['rules'],
        code: 'rule_credential_not_in_catalog',
        message: `Rule credential reference is absent from the active catalog: ${reference}`,
      });
    }
  }
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
