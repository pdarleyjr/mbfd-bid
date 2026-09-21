import type {
  AnnualRuleProfile,
  BidDefinitionContent,
  BidDefinitionRule,
  FrozenLiveBidPolicy,
  PendingLiveBidPolicy,
} from '@mbfd/shared';
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
  let content = parsed.data;
  if (content.authoring?.reconciliation === 'PROFILE_EDITS_PENDING_REVIEW') {
    const result = materializeBidDefinitionProfiles(content);
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
    content = result.content;
  }
  const timing = compileADayTimingExceptionScopes(content);
  if (!timing.ok)
    return {
      ok: false as const,
      error: 'profile_compilation_conflict',
      issues: timing.conflicts.map((conflict) => ({
        path: ['annualOperations', conflict.positionId, conflict.field],
        code: 'a_day_timing_scope_compilation_conflict',
        message: conflict.reason,
      })),
    };
  return { ok: true as const, content: timing.content };
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

type AnnualPolicyCandidate = FrozenLiveBidPolicy | PendingLiveBidPolicy;
type TimingException = NonNullable<
  NonNullable<
    NonNullable<AnnualPolicyCandidate['annualOperations']>['aDay']['execution']
  >['timingExceptions']
>[number];

type ADayTimingScopeCompilation =
  | { ok: true; content: BidDefinitionContent }
  | { ok: false; conflicts: AnnualRuleConflict[] };

function profileScopePositionIds(profile: AnnualRuleProfile): string[] {
  if (profile.scope.kind === 'position') return [profile.scope.positionId];
  if (profile.scope.kind === 'family') return profile.scope.positionIds;
  return [];
}

function uniqueConflicts(conflicts: readonly AnnualRuleConflict[]): AnnualRuleConflict[] {
  const entries = new Map<string, AnnualRuleConflict>();
  for (const conflict of conflicts) {
    const profileIds = [...new Set(conflict.profileIds)].sort(compareId);
    const normalized = { ...conflict, profileIds };
    entries.set(
      [normalized.positionId, normalized.field, profileIds.join(','), normalized.reason].join(
        '\u0000',
      ),
      normalized,
    );
  }
  return [...entries.values()].sort(
    (left, right) =>
      compareId(left.positionId, right.positionId) ||
      compareId(left.field, right.field) ||
      compareId(left.reason, right.reason),
  );
}

function compilePolicyADayTimingScopes<T extends AnnualPolicyCandidate>(
  policy: T,
  profiles: ReadonlyMap<string, AnnualRuleProfile>,
  profilePositionIds: ReadonlyMap<string, readonly string[]>,
  allPositionIds: ReadonlySet<string>,
  biddablePositionIds: ReadonlySet<string>,
): { policy: T; conflicts: AnnualRuleConflict[] } {
  const execution = policy.annualOperations?.aDay.execution;
  const exceptions = execution?.timingExceptions;
  if (!execution || !exceptions?.length) return { policy, conflicts: [] };

  const conflicts: AnnualRuleConflict[] = [];
  const resolvedScopes: Array<{ exception: TimingException; positionIds: string[] }> = [];
  for (const [index, exception] of exceptions.entries()) {
    const field = `aDay.timingExceptions[${index}].profileIds`;
    const profileIds = [...new Set(exception.profileIds)].sort(compareId);
    const resolved = new Set<string>();
    for (const positionId of exception.positionIds) {
      if (!allPositionIds.has(positionId)) {
        conflicts.push({
          positionId,
          field: `aDay.timingExceptions[${index}].positionIds`,
          profileIds: [],
          reason:
            'Explicit A-Day timing scope references an opportunity absent from this Bid definition',
        });
      } else if (!biddablePositionIds.has(positionId)) {
        conflicts.push({
          positionId,
          field: `aDay.timingExceptions[${index}].positionIds`,
          profileIds: [],
          reason: 'A-Day timing scope must resolve only biddable, non-excluded opportunities',
        });
      } else resolved.add(positionId);
    }
    for (const profileId of profileIds) {
      const profile = profiles.get(profileId);
      if (!profile) {
        conflicts.push({
          positionId: exception.id,
          field,
          profileIds: [profileId],
          reason:
            'A-Day timing exception references a shared profile absent from this Bid definition',
        });
        continue;
      }
      for (const positionId of profileScopePositionIds(profile))
        if (!allPositionIds.has(positionId))
          conflicts.push({
            positionId,
            field,
            profileIds: [profileId],
            reason:
              'Shared profile scope references an opportunity absent from this Bid definition',
          });
      for (const positionId of profilePositionIds.get(profileId) ?? []) resolved.add(positionId);
    }
    const positionIds = [...resolved].sort(compareId);
    if (!positionIds.length && !conflicts.some((conflict) => conflict.field === field))
      conflicts.push({
        positionId: exception.id,
        field,
        profileIds,
        reason: 'A-Day timing exception resolves to no biddable, non-excluded opportunities',
      });
    resolvedScopes.push({ exception, positionIds });
  }
  const governedBy = new Map<string, { index: number; exception: TimingException }>();
  for (const [index, scope] of resolvedScopes.entries())
    for (const positionId of scope.positionIds) {
      const prior = governedBy.get(positionId);
      if (prior) {
        conflicts.push({
          positionId,
          field: `aDay.timingExceptions[${index}].positionIds`,
          profileIds: [
            ...new Set([...prior.exception.profileIds, ...scope.exception.profileIds]),
          ].sort(compareId),
          reason: `Opportunity is already governed by A-Day timing exception ${prior.index + 1}`,
        });
      } else governedBy.set(positionId, { index, exception: scope.exception });
    }
  if (conflicts.length) return { policy, conflicts };
  return {
    policy: {
      ...policy,
      annualOperations: {
        ...policy.annualOperations,
        aDay: {
          ...policy.annualOperations?.aDay,
          execution: {
            ...execution,
            timingExceptions: resolvedScopes.map(({ exception, positionIds }) => ({
              ...exception,
              positionIds,
              profileIds: [...new Set(exception.profileIds)].sort(compareId),
            })),
          },
        },
      },
    },
    conflicts: [],
  };
}

/** Resolves A-Day profile provenance only against this candidate's captured
 * topology. It is called by candidate Save and optional review, never by a
 * historical version loader or generic canonicalization. */
export function compileADayTimingExceptionScopes(
  content: BidDefinitionContent,
): ADayTimingScopeCompilation {
  const positions = biddablePositions(content);
  const allPositionIds = new Set(content.positions.map((position) => position.id));
  const biddablePositionIds = new Set(positions.map((position) => position.id));
  const profiles = new Map(
    (content.authoring?.profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const profilePositionIds = new Map(
    profileMappings([...profiles.values()], positions).map((mapping) => [
      mapping.id,
      mapping.positionIds,
    ]),
  );
  const settings =
    content.settings?.v === 3
      ? compilePolicyADayTimingScopes(
          content.settings.livePolicy,
          profiles,
          profilePositionIds,
          allPositionIds,
          biddablePositionIds,
        )
      : null;
  const policy = content.policy
    ? compilePolicyADayTimingScopes(
        content.policy.executionPolicy,
        profiles,
        profilePositionIds,
        allPositionIds,
        biddablePositionIds,
      )
    : null;
  const pendingPolicy = content.pendingPolicy
    ? compilePolicyADayTimingScopes(
        content.pendingPolicy.executionPolicy,
        profiles,
        profilePositionIds,
        allPositionIds,
        biddablePositionIds,
      )
    : null;
  const conflicts = uniqueConflicts([
    ...(settings?.conflicts ?? []),
    ...(policy?.conflicts ?? []),
    ...(pendingPolicy?.conflicts ?? []),
  ]);
  if (conflicts.length) return { ok: false, conflicts };
  return {
    ok: true,
    content: {
      ...content,
      ...(settings && content.settings?.v === 3
        ? { settings: { ...content.settings, livePolicy: settings.policy } }
        : {}),
      ...(policy && content.policy
        ? { policy: { ...content.policy, executionPolicy: policy.policy } }
        : {}),
      ...(pendingPolicy && content.pendingPolicy
        ? { pendingPolicy: { ...content.pendingPolicy, executionPolicy: pendingPolicy.policy } }
        : {}),
    },
  };
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
