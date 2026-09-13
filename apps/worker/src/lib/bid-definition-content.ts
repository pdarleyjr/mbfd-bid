import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  type BidDefinitionIssue,
  type BidDefinitionRule,
  type FrozenLiveBidPolicy,
} from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import {
  type RuleBookCoverage,
  evaluateRuleBookCoverage,
  validateAnnualPolicyDefinitionReferences,
} from './bid-policy.js';
import { decodePositionRule } from './position-rule.js';

// These are schema identities for a pure evaluation, never persisted aliases.
const CONTENT_IDENTITY = 'bid-definition-content-v1';
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value: unknown) => canonicalize(value as JsonValue);
export const bidContentHash = (value: string) =>
  bytesToHex(sha256(new TextEncoder().encode(value)));

export function definitionRuleRows(
  content: BidDefinitionContent,
  ruleBookVersion: string,
  templateVersion: string,
) {
  return content.rules.map((rule) => ({ ...rule, ruleBookVersion, templateVersion }));
}

/** Only collections proven to be sets or keyed rows are reordered. Scoring,
 * priority chains, requirement/reason order and specialty sequences stay intact. */
function normalizePolicy(policy: FrozenLiveBidPolicy) {
  policy.stages.sort((a, b) => a.order - b.order);
  for (const stage of policy.stages) {
    stage.memberIds.sort((a, b) => a - b);
    stage.opportunityPositionIds = [...new Set(stage.opportunityPositionIds)].sort(compareId);
  }
  policy.dispositions.sort((a, b) => compareId(a.disposition, b.disposition));
  policy.actionPermissions.sort((a, b) => compareId(a.action, b.action));
  for (const permission of policy.actionPermissions)
    permission.actorMemberIds = [...new Set(permission.actorMemberIds)].sort((a, b) => a - b);
  if (policy.annualOperations)
    policy.annualOperations.requiredTopologyPositionIds = [
      ...new Set(policy.annualOperations.requiredTopologyPositionIds),
    ].sort(compareId);
}

function normalizeRule(
  rule: BidDefinitionRule,
  path: (string | number)[],
  issues: BidDefinitionIssue[],
): BidDefinitionRule {
  const decoded = decodePositionRule({ ...rule, ruleBookVersion: CONTENT_IDENTITY });
  if (!decoded.ok) {
    for (const issue of decoded.issues)
      issues.push({
        path: [...path, issue.column],
        code: issue.code,
        message: issue.message,
      });
    return rule;
  }
  // Preserve every ordered algorithm input. In particular capped score items,
  // requirement explanation order and tie-break chains cannot be sorted.
  return {
    positionId: rule.positionId,
    requiredCriteriaJson: canonical(decoded.rule.requiredCriteria),
    pointsPreferenceJson: canonical(decoded.rule.pointsPreference),
    tieBreakChainJson: canonical(decoded.rule.tieBreakChain),
    notes: rule.notes,
  };
}

function unique<T>(
  rows: T[],
  identity: (row: T) => string,
  path: string,
  issues: BidDefinitionIssue[],
) {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const id = identity(row);
    if (seen.has(id))
      issues.push({
        path: [path, index],
        code: 'duplicate_identity',
        message: `Duplicate identity: ${id}`,
      });
    seen.add(id);
  });
  return seen;
}

export type CanonicalBidDefinition =
  | {
      ok: true;
      content: BidDefinitionContent;
      serialized: string;
      sha256: string;
      coverage: RuleBookCoverage;
    }
  | { ok: false; issues: BidDefinitionIssue[] };

/** One deterministic content encoding for saves, comparisons and previews.
 * This validates existing primitives; it contains no eligibility calculations.
 * Structurally valid incomplete drafts retain explicit coverage deficiencies.
 * Unknown, duplicate, orphaned or contradictory material is never accepted. */
export function canonicalBidDefinition(input: unknown): CanonicalBidDefinition {
  try {
    return normalizeBidDefinition(input);
  } catch {
    return {
      ok: false,
      issues: [
        {
          path: [],
          code: 'non_json_definition_content',
          message: 'Bid material must contain only canonical JSON values',
        },
      ],
    };
  }
}

function normalizeBidDefinition(input: unknown): CanonicalBidDefinition {
  const parsed = BidDefinitionContentSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    };
  const content = parsed.data;
  if (content.settings?.v === 3) normalizePolicy(content.settings.livePolicy);
  if (content.policy) normalizePolicy(content.policy.executionPolicy);
  const issues: BidDefinitionIssue[] = [];
  const positionIds = unique(content.positions, (row) => row.id, 'positions', issues);
  unique(content.rules, (row) => row.positionId, 'rules', issues);
  unique(content.participation, (row) => row.positionId, 'participation', issues);
  unique(content.staffingBindings, (row) => row.positionId, 'staffingBindings', issues);
  unique(content.staffingBindings, (row) => row.staffingPositionId, 'staffingBindings', issues);
  unique(content.sourceDecisions, (row) => row.issueId, 'sourceDecisions', issues);
  for (const field of ['rules', 'participation', 'staffingBindings'] as const) {
    content[field].forEach((row, index) => {
      if (!positionIds.has(row.positionId))
        issues.push({
          path: [field, index, 'positionId'],
          code: 'position_not_in_definition',
          message: 'Referenced opportunity is absent from this Bid definition',
        });
    });
  }
  content.rules = content.rules.map((rule, index) => normalizeRule(rule, ['rules', index], issues));
  if (content.authoring) {
    unique(
      content.authoring.compiled,
      (entry) => entry.rule.positionId,
      'authoring.compiled',
      issues,
    );
    const profileIds = new Set(content.authoring.profiles.map((profile) => profile.id));
    content.authoring.compiled = content.authoring.compiled.map((entry, index) => {
      for (const [field, ids] of Object.entries(entry.provenance)) {
        for (const id of ids)
          if (!profileIds.has(id))
            issues.push({
              path: ['authoring', 'compiled', index, 'provenance', field],
              code: 'unknown_profile',
              message:
                'Compilation refers to a profile absent from its captured authoring material',
            });
      }
      return {
        ...entry,
        rule: normalizeRule(entry.rule, ['authoring', 'compiled', index, 'rule'], issues),
      };
    });
    content.authoring.profiles.sort((a, b) => compareId(a.id, b.id));
    content.authoring.compiled.sort((a, b) => compareId(a.rule.positionId, b.rule.positionId));
  }
  if (
    content.policy &&
    (content.settings?.v !== 3 ||
      canonical(content.policy.executionPolicy) !== canonical(content.settings.livePolicy))
  ) {
    issues.push({
      path: ['policy', 'executionPolicy'],
      code: 'policy_settings_mismatch',
      message: 'Source document execution policy differs from the configured Bid policy',
    });
  }
  if (issues.length) return { ok: false, issues };
  content.positions.sort((a, b) => compareId(a.id, b.id));
  content.rules.sort((a, b) => compareId(a.positionId, b.positionId));
  content.participation.sort((a, b) => compareId(a.positionId, b.positionId));
  content.staffingBindings.sort((a, b) => compareId(a.positionId, b.positionId));
  content.sourceDecisions.sort((a, b) => compareId(a.issueId, b.issueId));
  const participation = new Map(
    content.participation.map((row) => [row.positionId, row.bidParticipation]),
  );
  const material = {
    v: 1 as const,
    rules: definitionRuleRows(content, CONTENT_IDENTITY, CONTENT_IDENTITY),
    positions: content.positions.map((position) => ({
      ...position,
      templateVersion: CONTENT_IDENTITY,
      bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
    })),
  };
  if (content.settings?.v === 3) {
    const references = validateAnnualPolicyDefinitionReferences(
      material,
      content.settings.livePolicy,
    );
    if (references.length)
      return {
        ok: false,
        issues: references.map((code) => ({
          path: ['settings', 'livePolicy'],
          code,
          message: 'Configured policy references or order do not match this Bid definition',
        })),
      };
  }
  const coverage = evaluateRuleBookCoverage({
    ...material,
    ruleBookVersion: CONTENT_IDENTITY,
    declaredTemplateVersion: CONTENT_IDENTITY,
  });
  // A coverage omission can be an unfinished draft. A rule on a non-biddable
  // or excluded opportunity is contradictory material, not a missing answer.
  if (coverage.nonBiddablePositionIds.length)
    return {
      ok: false,
      issues: coverage.nonBiddablePositionIds.map((id) => ({
        path: ['rules'],
        code: 'rule_on_non_biddable_position',
        message: `Rule targets non-biddable opportunity: ${id}`,
      })),
    };
  const serialized = canonical(content);
  return { ok: true, content, serialized, sha256: bidContentHash(serialized), coverage };
}
