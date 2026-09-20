import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  type BidDefinitionIssue,
  type BidDefinitionRule,
  type FrozenLiveBidPolicy,
  bidOrderingComparatorForStage,
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

/** The canonical definition and unsaved evaluator use the same material adapter.
 * The default identifiers describe in-memory material, never persisted provenance. */
export function definitionRuleBookMaterial(
  content: BidDefinitionContent,
  ruleBookVersion = CONTENT_IDENTITY,
  templateVersion = CONTENT_IDENTITY,
) {
  const participation = new Map(
    content.participation.map((row) => [row.positionId, row.bidParticipation]),
  );
  return {
    v: 1 as const,
    rules: definitionRuleRows(content, ruleBookVersion, templateVersion).map(
      ({ notes: _notes, ...rule }) => rule,
    ),
    positions: content.positions.map((position) => ({
      ...position,
      templateVersion,
      bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
    })),
  };
}

/** Only collections proven to be sets or keyed rows are reordered. Scoring,
 * priority chains, requirement/reason order and specialty sequences stay intact. */
function normalizePolicy(
  policy:
    | FrozenLiveBidPolicy
    | NonNullable<BidDefinitionContent['pendingPolicy']>['executionPolicy'],
) {
  if (policy.orderingAuthority?.v === 2)
    policy.orderingAuthority.stages.sort((a, b) => compareId(a.stageId, b.stageId));
  policy.stages.sort((a, b) => a.order - b.order);
  for (const stage of policy.stages) {
    if (stage.participantProvenance?.orderingAuthority?.v === 2)
      stage.participantProvenance.orderingAuthority.stages.sort((a, b) =>
        compareId(a.stageId, b.stageId),
      );
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
  const constraints = policy.annualOperations?.aDay.execution?.constraints;
  const terms = policy.annualOperations?.assignmentTerms;
  if (terms) {
    terms.sort((a, b) => compareId(a.id, b.id));
    for (const term of terms) term.positionIds.sort(compareId);
  }
  const fallbacks = policy.annualOperations?.fallbackPolicies;
  policy.annualOperations?.opportunityPools?.sort((a, b) => compareId(a.id, b.id));
  const distributions = policy.annualOperations?.membershipDistributions;
  if (distributions) {
    distributions.sort((a, b) => compareId(a.id, b.id));
    for (const distribution of distributions) {
      distribution.memberIds.sort((a, b) => a - b);
      distribution.shifts.sort(compareId);
    }
  }
  if (fallbacks) {
    fallbacks.sort((a, b) => compareId(a.id, b.id));
    // Tier and comparator sequence is policy order, not a set.
    for (const fallback of fallbacks) fallback.positionIds.sort(compareId);
  }
  if (constraints) {
    constraints.sort((a, b) => compareId(a.id, b.id));
    for (const rule of constraints) {
      rule.positionIds.sort(compareId);
      rule.memberIds.sort((a, b) => a - b);
      rule.ranks.sort(compareId);
      rule.shifts.sort(compareId);
    }
  }
}

/** Selector definitions are keyed by stage and their explicit ids/filter
 * ranks are membership sets. Comparator rule order remains intentional. */
function normalizeStageParticipantSourceAuthoring(
  policy: Pick<NonNullable<BidDefinitionContent['policy']>, 'stageParticipantSources'>,
) {
  const sources = policy.stageParticipantSources;
  if (sources === undefined) return;
  for (const source of sources) {
    if (source.participantSource.type === 'EXPLICIT_MEMBERS')
      source.participantSource.memberIds.sort((a, b) => a - b);
    else source.participantSource.ranks.sort(compareId);
  }
  sources.sort((a, b) => compareId(a.stageId, b.stageId));
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

/** A comparator request can remain OPEN, but its identifier must still point
 * to actual annual-policy evidence in the saved definition. Resolution and
 * freezing remain a later, fail-closed preparation concern. */
function validateOrderingAuthorityRequest(
  content: BidDefinitionContent,
  issues: BidDefinitionIssue[],
) {
  const request = content.policy?.orderingAuthority;
  if (request === undefined) return;
  if (request.v === 2) {
    const stages = content.policy?.executionPolicy.stages ?? [];
    if (
      stages.length !== request.stages.length ||
      stages.some((stage) => !request.stages.some((entry) => entry.stageId === stage.id))
    )
      issues.push({
        path: ['policy', 'orderingAuthority', 'stages'],
        code: 'ordering_authority_stage_mismatch',
        message: 'Specify an ordering rule for every configured stage.',
      });
  }
  const sourceDecision = content.sourceDecisions.find(
    (decision) => decision.issueId === request.sourceDecisionId,
  );
  if (sourceDecision === undefined) {
    issues.push({
      path: ['policy', 'orderingAuthority', 'sourceDecisionId'],
      code: 'ordering_authority_source_decision_missing',
      message: 'The ordering-authority request must name a saved annual-policy source decision.',
    });
  } else if (sourceDecision.area !== 'annual-policy') {
    issues.push({
      path: ['policy', 'orderingAuthority', 'sourceDecisionId'],
      code: 'ordering_authority_source_decision_not_annual_policy',
      message: 'The ordering-authority request must name source evidence in annual-policy.',
    });
  }
}

/**
 * Typed participant authoring is keyed to an already-saved V3 execution
 * policy. This checks only that the authoring describes that exact policy and
 * does not contradict a comparator request already present in the same saved
 * definition. It deliberately does not resolve source decisions: an OPEN or
 * otherwise unresolved decision remains representable as a draft.
 */
function validateStageParticipantSourceAuthoring(
  content: BidDefinitionContent,
  issues: BidDefinitionIssue[],
) {
  const policy = content.policy;
  const sources = policy?.stageParticipantSources;
  if (policy === null || sources === undefined) return;

  const executionStageIds = new Set(policy.executionPolicy.stages.map((stage) => stage.id));
  const describesExactExecutionStages =
    sources.length === executionStageIds.size &&
    sources.every((source) => executionStageIds.has(source.stageId));
  if (!describesExactExecutionStages) {
    issues.push({
      path: ['policy', 'stageParticipantSources'],
      code: 'stage_participant_source_stage_mismatch',
      message: 'Typed stage participant sources must describe every configured execution stage.',
    });
  }

  if (policy.orderingAuthority === undefined) return;
  sources.forEach((source, index) => {
    const requestedComparator = bidOrderingComparatorForStage(
      policy.orderingAuthority,
      source.stageId,
    );
    if (
      requestedComparator !== undefined &&
      canonical(source.ordering) === canonical(requestedComparator)
    )
      return;
    issues.push({
      path: ['policy', 'stageParticipantSources', index, 'ordering'],
      code: 'stage_participant_source_ordering_mismatch',
      message:
        'Typed stage participant ordering must match the saved ordering-authority comparator request.',
    });
  });
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
  if (content.policy?.orderingAuthority?.v === 2)
    content.policy.orderingAuthority.stages.sort((a, b) => compareId(a.stageId, b.stageId));
  for (const decision of content.sourceDecisions) {
    if (decision.resolution?.v === 2)
      decision.resolution.stages.sort((a, b) => compareId(a.stageId, b.stageId));
  }
  if (content.settings?.v === 3) normalizePolicy(content.settings.livePolicy);
  if (content.policy) {
    normalizePolicy(content.policy.executionPolicy);
    normalizeStageParticipantSourceAuthoring(content.policy);
  }
  if (content.pendingPolicy) {
    normalizePolicy(content.pendingPolicy.executionPolicy);
    normalizeStageParticipantSourceAuthoring(content.pendingPolicy);
    if (content.pendingPolicy.orderingAuthority?.v === 2)
      content.pendingPolicy.orderingAuthority.stages.sort((a, b) =>
        compareId(a.stageId, b.stageId),
      );
  }
  const issues: BidDefinitionIssue[] = [];
  const positionIds = unique(content.positions, (row) => row.id, 'positions', issues);
  unique(content.rules, (row) => row.positionId, 'rules', issues);
  unique(content.participation, (row) => row.positionId, 'participation', issues);
  unique(content.staffingBindings, (row) => row.positionId, 'staffingBindings', issues);
  unique(content.staffingBindings, (row) => row.staffingPositionId, 'staffingBindings', issues);
  unique(content.sourceDecisions, (row) => row.issueId, 'sourceDecisions', issues);
  const fallbacks = content.policy?.executionPolicy.annualOperations?.fallbackPolicies ?? [];
  for (const field of ['opportunityPools', 'membershipDistributions'] as const) {
    const entries = content.policy?.executionPolicy.annualOperations?.[field] ?? [];
    for (const [index, entry] of entries.entries()) {
      const source = content.sourceDecisions.find(
        (decision) => decision.issueId === entry.sourceDecisionId,
      );
      if (!source || source.area !== 'annual-policy')
        issues.push({
          path: ['policy', 'executionPolicy', 'annualOperations', field, index, 'sourceDecisionId'],
          code: 'assignment_source_decision_missing',
          message: 'Assignment semantics must reference an annual-policy source decision.',
        });
    }
  }
  for (const [index, fallback] of fallbacks.entries()) {
    const source = content.sourceDecisions.find(
      (decision) => decision.issueId === fallback.sourceDecisionId,
    );
    if (!source || source.area !== 'annual-policy')
      issues.push({
        path: [
          'policy',
          'executionPolicy',
          'annualOperations',
          'fallbackPolicies',
          index,
          'sourceDecisionId',
        ],
        code: 'fallback_source_decision_missing',
        message: 'Fallback must reference an annual-policy source decision.',
      });
  }
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
  validateOrderingAuthorityRequest(content, issues);
  validateStageParticipantSourceAuthoring(content, issues);
  if (issues.length) return { ok: false, issues };
  content.positions.sort((a, b) => compareId(a.id, b.id));
  content.rules.sort((a, b) => compareId(a.positionId, b.positionId));
  content.participation.sort((a, b) => compareId(a.positionId, b.positionId));
  content.staffingBindings.sort((a, b) => compareId(a.positionId, b.positionId));
  content.sourceDecisions.sort((a, b) => compareId(a.issueId, b.issueId));
  const material = definitionRuleBookMaterial(content);
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
