import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import referenceCredentials from '../seed/fixtures/reference_credentials.json';
import { evaluateRuleBookCoverage } from '../src/lib/bid-policy.js';
import { buildCorrected2026DraftRules } from '../src/lib/corrected-2026-draft-rules.js';
import { buildCorrected2026SemanticRoles } from '../src/lib/corrected-2026-semantic-roles.js';
import { buildCorrected2026Topology } from '../src/lib/corrected-2026-topology.js';
import {
  POLICY_2026_CREDENTIALS,
  POLICY_2026_EXISTING_CREDENTIAL_BINDINGS,
} from '../src/lib/policy-2026-credentials.js';

const draft = buildCorrected2026DraftRules();
const positions = buildCorrected2026Topology();
const roles = buildCorrected2026SemanticRoles();
const participation = new Map(roles.map((role) => [role.positionId, role.bidParticipation]));
const candidateAlias = '2026.corrected.candidate';
const catalog = new Set([
  ...referenceCredentials.map((credential) => credential.name),
  ...POLICY_2026_EXISTING_CREDENTIAL_BINDINGS.map((entry) => entry.name),
]);
const reviewedPolicyDefinitions = new Set(POLICY_2026_CREDENTIALS.map((entry) => entry.name));
const citedCredentials = new Set(
  draft.rules.flatMap((rule) => [
    ...rule.requiredCriteria.credentials,
    ...(rule.requiredCriteria.postAward ?? []).map((obligation) => obligation.credential),
    ...(rule.pointsPreference.scoring?.total ?? []).flatMap((group) => [
      ...(group.excludesAny ?? []),
      ...group.items.flatMap((item) => [
        item.credential,
        ...item.requiresAll,
        ...item.alternatives,
      ]),
      ...(group.preference?.criteria ?? []).flatMap((criterion) => [
        criterion.credential,
        ...criterion.requiresAll,
        ...criterion.alternatives,
      ]),
    ]),
    ...(rule.pointsPreference.scoring?.orderedPreference?.criteria ?? []).flatMap((criterion) => [
      criterion.credential,
      ...criterion.alternatives,
      ...criterion.requiresAll,
    ]),
  ]),
);
const absentFromLocalFixtureAndReviewedExistingBindings = [...citedCredentials]
  .filter((name) => !catalog.has(name))
  .sort();
const missingReviewedDefinitions = absentFromLocalFixtureAndReviewedExistingBindings.filter(
  (name) => !reviewedPolicyDefinitions.has(name),
);
const coverage = evaluateRuleBookCoverage({
  ruleBookVersion: candidateAlias,
  declaredTemplateVersion: candidateAlias,
  enforcePositionRank: true,
  credentialCatalogNames: [...catalog, ...reviewedPolicyDefinitions],
  positions: positions.map((position) => ({
    id: position.id,
    templateVersion: candidateAlias,
    rankRequired: position.rankRequired,
    isExcludedFromCount: position.isExcludedFromCount,
    bidParticipation:
      participation.get(position.id) === 'BIDDABLE'
        ? 'BIDDABLE'
        : participation.get(position.id) === 'CLOSED'
          ? 'RESERVED_NON_BIDDABLE'
          : 'ADMIN_ASSIGNED_NON_BIDDABLE',
  })),
  rules: draft.rules.map((rule) => ({
    ruleBookVersion: candidateAlias,
    templateVersion: candidateAlias,
    positionId: rule.positionId,
    requiredCriteriaJson: JSON.stringify(rule.requiredCriteria),
    pointsPreferenceJson: JSON.stringify(rule.pointsPreference),
    tieBreakChainJson: JSON.stringify(rule.tieBreakChain),
  })),
});
if (!coverage.valid || missingReviewedDefinitions.length > 0) {
  throw new Error(
    `corrected_2026_rule_coverage_invalid:${JSON.stringify({
      missingReviewedDefinitions,
      duplicatePositionIds: coverage.duplicatePositionIds,
      rankMismatchPositionIds: coverage.rankMismatchPositionIds,
      missingBiddablePositionIds: coverage.missingBiddablePositionIds,
      nonBiddablePositionIds: coverage.nonBiddablePositionIds,
      unresolvedCredentialReferences: coverage.unresolvedCredentialReferences,
    })}`,
  );
}
const output = resolve(
  import.meta.dirname,
  '../../../docs/unified-platform/2026-corrected-draft-rule-audit.json',
);
await writeFile(
  output,
  `${JSON.stringify({ ...draft, ruleCoverage: { valid: coverage.valid, expectedBiddable: coverage.expectedBiddablePositionIds.length, validRules: coverage.validRulePositionIds.length, rankMismatches: coverage.rankMismatchPositionIds, duplicateRules: coverage.duplicatePositionIds, unresolvedCredentialReferences: coverage.unresolvedCredentialReferences }, absentFromLocalFixtureAndReviewedExistingBindings, reviewedExistingCatalogBindings: POLICY_2026_EXISTING_CREDENTIAL_BINDINGS, reviewedNewPolicyDefinitions: POLICY_2026_CREDENTIALS, missingReviewedDefinitions }, null, 2)}\n`,
);
