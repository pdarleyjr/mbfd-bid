import type { AnnualRuleProfile, BidDefinitionContent, BidDefinitionRule } from '@mbfd/shared';
import { BidDefinitionContentSchema } from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import {
  type AnnualRuleConflict,
  type AnnualRulePosition,
  annualRuleProfileMatchesPosition,
  compileAnnualRules,
} from './annual-rule-compiler.js';

const MATERIALIZATION_RULE_BOOK_VERSION = 'profile-materialization-v1';
const canonical = (value: unknown) => canonicalize(value as JsonValue);
const compareId = (left: string, right: string) => left.localeCompare(right);

/** Compile known authoring before canonical rule coverage checks: a topology
 * edit may legitimately leave old derived rules on a newly closed opportunity. */
export function materializePendingBidProfiles(raw: unknown) {
  const parsed = BidDefinitionContentSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false as const, error: 'invalid_bid_definition', issues: parsed.error.issues };
  if (parsed.data.authoring?.reconciliation !== 'PROFILE_EDITS_PENDING_REVIEW')
    return { ok: true as const, content: parsed.data };
  const result = materializeBidDefinitionProfiles(parsed.data);
  if (!result.ok)
    return {
      ok: false as const,
      error: result.code,
      issues: result.conflicts.map((conflict) => ({
        path: ['authoring', conflict.positionId, conflict.field],
        code: 'profile_compilation_conflict',
        message: conflict.reason,
      })),
    };
  return { ok: true as const, content: result.content };
}

export type ProfilePositionMapping = {
  id: string;
  name: string;
  sourceRef: string;
  scope: AnnualRuleProfile['scope'];
  positionIds: string[];
};

export type MaterializedBidProfileRule = {
  rule: BidDefinitionRule;
  provenance: {
    requirements: string[];
    scoring: string[];
    priorities: string[];
    matched: string[];
  };
};

export type BidProfileMaterialization =
  | {
      ok: true;
      content: BidDefinitionContent;
      compiled: MaterializedBidProfileRule[];
      profileMappings: ProfilePositionMapping[];
      biddablePositionIds: string[];
    }
  | {
      ok: false;
      code: 'profile_authoring_unavailable' | 'profile_compilation_conflict';
      conflicts: AnnualRuleConflict[];
      profileMappings: ProfilePositionMapping[];
      biddablePositionIds: string[];
    };

function biddablePositions(content: BidDefinitionContent): AnnualRulePosition[] {
  const participation = new Map(
    content.participation.map((row) => [row.positionId, row.bidParticipation]),
  );
  return content.positions
    .filter(
      (position) =>
        position.isExcludedFromCount !== true &&
        (participation.get(position.id) ?? 'BIDDABLE') === 'BIDDABLE',
    )
    .map((position) => ({
      id: position.id,
      station: position.station,
      shift: position.shift,
      rank: position.rankRequired,
    }))
    .sort((left, right) => compareId(left.id, right.id));
}

function profileMappings(
  profiles: readonly AnnualRuleProfile[],
  positions: readonly AnnualRulePosition[],
): ProfilePositionMapping[] {
  return [...profiles]
    .sort((left, right) => compareId(left.id, right.id))
    .map((profile) => ({
      id: profile.id,
      name: profile.name,
      sourceRef: profile.sourceRef,
      scope: profile.scope,
      positionIds: positions
        .filter((position) => annualRuleProfileMatchesPosition(profile, position))
        .map((position) => position.id)
        .sort(compareId),
    }));
}

function concreteRule(
  input: ReturnType<typeof compileAnnualRules>['compiled'][number],
  notes: string | null,
): BidDefinitionRule {
  return {
    positionId: input.rule.positionId,
    requiredCriteriaJson: canonical(input.rule.requiredCriteria),
    pointsPreferenceJson: canonical(input.rule.pointsPreference),
    tieBreakChainJson: canonical(input.rule.tieBreakChain),
    notes,
  };
}

/**
 * Purely compiles the explicit profile source against exactly the candidate's
 * biddable, non-excluded opportunities. This does not read a database,
 * resolve a browser draft, create a version, or write any material.
 */
export function materializeBidDefinitionProfiles(
  content: BidDefinitionContent,
): BidProfileMaterialization {
  const positions = biddablePositions(content);
  const biddablePositionIds = positions.map((position) => position.id);
  const authoring = content.authoring;
  if (authoring === null)
    return {
      ok: false,
      code: 'profile_authoring_unavailable',
      conflicts: [],
      profileMappings: [],
      biddablePositionIds,
    };
  const profiles = [...authoring.profiles].sort((left, right) => compareId(left.id, right.id));
  const mappings = profileMappings(profiles, positions);
  const allPositionIds = new Set(content.positions.map((position) => position.id));
  const biddableIds = new Set(biddablePositionIds);
  const scopeConflicts: AnnualRuleConflict[] = [];
  const applicableProfiles: AnnualRuleProfile[] = [];
  for (const profile of profiles) {
    const ids =
      profile.scope.kind === 'position'
        ? [profile.scope.positionId]
        : profile.scope.kind === 'family'
          ? profile.scope.positionIds
          : [];
    for (const id of ids)
      if (!allPositionIds.has(id))
        scopeConflicts.push({
          positionId: id,
          field: 'scope',
          profileIds: [profile.id],
          reason: 'Scope references a position outside this Bid definition',
        });
    // Preserve closed-source authoring, but materialize only selectable seats.
    if (profile.scope.kind === 'position' && !biddableIds.has(profile.scope.positionId)) continue;
    if (profile.scope.kind === 'family') {
      const positionIds = profile.scope.positionIds.filter((id) => biddableIds.has(id));
      if (positionIds.length)
        applicableProfiles.push({ ...profile, scope: { ...profile.scope, positionIds } });
    } else applicableProfiles.push(profile);
  }
  if (scopeConflicts.length)
    return {
      ok: false,
      code: 'profile_compilation_conflict',
      conflicts: scopeConflicts,
      profileMappings: mappings,
      biddablePositionIds,
    };
  const result = compileAnnualRules(
    positions,
    applicableProfiles,
    MATERIALIZATION_RULE_BOOK_VERSION,
  );
  if (!result.ok)
    return {
      ok: false,
      code: 'profile_compilation_conflict',
      conflicts: result.conflicts,
      profileMappings: mappings,
      biddablePositionIds,
    };

  const notesByPosition = new Map(content.rules.map((rule) => [rule.positionId, rule.notes]));
  const compiled = result.compiled
    .map((entry) => ({
      rule: concreteRule(entry, notesByPosition.get(entry.rule.positionId) ?? null),
      provenance: entry.provenance,
    }))
    .sort((left, right) => compareId(left.rule.positionId, right.rule.positionId));
  const rules = compiled.map((entry) => entry.rule);
  return {
    ok: true,
    content: {
      ...content,
      rules,
      authoring: {
        ...authoring,
        profiles,
        compiled,
        reconciliation: 'MATERIALIZED_FOR_CURRENT_VERSION',
      },
    },
    compiled,
    profileMappings: mappings,
    biddablePositionIds,
  };
}

/** The two historical states predate Current-Bid profile editing and retain
 * their established meaning. Only the explicit pending/materialized states
 * opt into the new save guard. */
export function validateMaterializedBidDefinitionProfiles(content: BidDefinitionContent):
  | { ok: true }
  | {
      ok: false;
      error:
        | 'profile_review_required'
        | 'profile_authoring_compilation_invalid'
        | 'profile_authoring_unapplied';
    } {
  const authoring = content.authoring;
  if (
    authoring === null ||
    authoring.reconciliation === 'MATCHES_CAPTURED_RULE_REVISION' ||
    authoring.reconciliation === 'RULES_CHANGED_AFTER_COMPILATION'
  )
    return { ok: true };
  if (authoring.reconciliation === 'PROFILE_EDITS_PENDING_REVIEW')
    return { ok: false, error: 'profile_review_required' };

  const materialized = materializeBidDefinitionProfiles(content);
  if (!materialized.ok) return { ok: false, error: 'profile_authoring_compilation_invalid' };
  const expectedAuthoring = materialized.content.authoring;
  if (
    expectedAuthoring === null ||
    canonical(content.rules) !== canonical(materialized.content.rules) ||
    canonical(authoring.compiled) !== canonical(expectedAuthoring.compiled)
  )
    return { ok: false, error: 'profile_authoring_unapplied' };
  return { ok: true };
}
