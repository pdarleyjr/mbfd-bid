import type { PositionRule, Rank } from '@mbfd/eligibility';
import type { AnnualRuleProfile } from '@mbfd/shared';

export type AnnualRulePosition = { id: string; station: string; shift: string; rank: Rank };
const SPECIFICITY = { department: 0, rank: 1, station_shift: 2, family: 3, position: 4 } as const;
function matches(profile: AnnualRuleProfile, position: AnnualRulePosition) {
  const scope = profile.scope;
  switch (scope.kind) {
    case 'department':
      return true;
    case 'rank':
      return scope.rank === position.rank;
    case 'station_shift':
      return scope.station === position.station && scope.shift === position.shift;
    case 'family':
      return scope.positionIds.includes(position.id);
    case 'position':
      return scope.positionId === position.id;
  }
}
export type CompiledAnnualRule = {
  rule: PositionRule;
  provenance: {
    requirements: string[];
    scoring: string[];
    priorities: string[];
    matched: string[];
  };
};
export type AnnualRuleConflict = {
  positionId: string;
  field: string;
  profileIds: string[];
  reason: string;
};

/** Requirements are additive; scoring and priority use the most specific whole definition.
 * Equal-specificity disagreement fails closed. No implicit base or current active book is used. */
export function compileAnnualRules(
  positions: AnnualRulePosition[],
  profiles: AnnualRuleProfile[],
  version: string,
) {
  const conflicts: AnnualRuleConflict[] = [];
  const compiled: CompiledAnnualRule[] = [];
  const positionIds = new Set(positions.map((p) => p.id));
  for (const profile of profiles) {
    const ids =
      profile.scope.kind === 'position'
        ? [profile.scope.positionId]
        : profile.scope.kind === 'family'
          ? profile.scope.positionIds
          : [];
    for (const id of ids)
      if (!positionIds.has(id))
        conflicts.push({
          positionId: id,
          field: 'scope',
          profileIds: [profile.id],
          reason: 'Scope references a position outside this annual plan',
        });
  }
  for (const position of positions) {
    const selected = profiles
      .filter((p) => matches(p, position))
      .sort(
        (a, b) => SPECIFICITY[a.scope.kind] - SPECIFICITY[b.scope.kind] || a.id.localeCompare(b.id),
      );
    let ranks: Rank[] = [position.rank];
    const credentials = new Set<string>();
    const alternatives = new Map<string, string[]>();
    const service = new Map<string, number>();
    const obligations = new Map<
      string,
      NonNullable<PositionRule['requiredCriteria']['postAward']>[number]
    >();
    const custom = new Set<PositionRule['requiredCriteria']['custom'][number]>();
    for (const p of selected) {
      for (const obligation of p.requirements.postAward ?? []) {
        const existing = obligations.get(obligation.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(obligation))
          conflicts.push({
            positionId: position.id,
            field: 'postAward',
            profileIds: selected
              .filter((p) => p.requirements.postAward?.some((o) => o.id === obligation.id))
              .map((p) => p.id),
            reason:
              'Inherited obligations with the same ID disagree; reconcile the deadline and source explicitly',
          });
        else obligations.set(obligation.id, obligation);
      }
      if (p.requirements.ranks)
        ranks = ranks.filter((rank) => p.requirements.ranks?.includes(rank));
      for (const value of p.requirements.credentials) credentials.add(value);
      for (const group of p.requirements.anyOfCredentials ?? []) {
        const normalized = [...group].sort();
        alternatives.set(JSON.stringify(normalized), normalized);
      }
      for (const requirement of p.requirements.service ?? [])
        service.set(
          requirement.serviceCode,
          Math.max(service.get(requirement.serviceCode) ?? 0, requirement.minimumMonths),
        );
      for (const value of p.requirements.custom) custom.add(value);
    }
    if (ranks.length === 0)
      conflicts.push({
        positionId: position.id,
        field: 'ranks',
        profileIds: selected.filter((p) => p.requirements.ranks).map((p) => p.id),
        reason: 'Requirements exclude the position rank',
      });
    function resolve<K extends 'scoring' | 'tieBreakChain'>(field: K) {
      const candidates = selected.filter((p) => p[field] !== undefined);
      const last = candidates.at(-1);
      const specificity = last ? SPECIFICITY[last.scope.kind] : -1;
      const winners = candidates.filter((p) => SPECIFICITY[p.scope.kind] === specificity);
      const value = winners[0]?.[field];
      if (value === undefined) {
        conflicts.push({
          positionId: position.id,
          field,
          profileIds: [],
          reason: 'An explicit definition is required',
        });
        return null;
      }
      if (winners.some((p) => JSON.stringify(p[field]) !== JSON.stringify(value))) {
        conflicts.push({
          positionId: position.id,
          field,
          profileIds: winners.map((p) => p.id),
          reason: 'Overlapping profiles at the same specificity disagree',
        });
        return null;
      }
      return { value, ids: winners.map((p) => p.id) };
    }
    const scoring = resolve('scoring');
    const priorities = resolve('tieBreakChain');
    if (scoring && priorities && ranks.length)
      compiled.push({
        rule: {
          positionId: position.id,
          ruleBookVersion: version,
          requiredCriteria: {
            rank: ranks,
            credentials: [...credentials].sort(),
            ...(alternatives.size
              ? {
                  anyOfCredentials: [...alternatives.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([, group]) => group),
                }
              : {}),
            ...(service.size
              ? {
                  service: [...service.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([serviceCode, minimumMonths]) => ({ serviceCode, minimumMonths })),
                }
              : {}),
            custom: [...custom].sort(),
            ...(obligations.size
              ? { postAward: [...obligations.values()].sort((a, b) => a.id.localeCompare(b.id)) }
              : {}),
          },
          pointsPreference: { max: 0, items: [], scoring: scoring.value },
          tieBreakChain: priorities.value,
        },
        provenance: {
          requirements: selected.map((p) => p.id),
          scoring: scoring.ids,
          priorities: priorities.ids,
          matched: selected.map((p) => p.id),
        },
      });
  }
  return { ok: conflicts.length === 0, compiled, conflicts };
}
