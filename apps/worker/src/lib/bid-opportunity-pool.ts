import {
  type BidOpportunityPool,
  BidOpportunityPoolsSchema,
  type FrozenLiveBidPolicy,
  type FrozenRuleBookMaterial,
} from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { decodePositionRule } from './position-rule.js';

const canonical = (value: unknown) => canonicalize(value as JsonValue);

/** All capacity slots must have interchangeable selection semantics. Display
 * labels and daily apparatus names never create or resolve a pool. */
export function validateBidOpportunityPools(
  material: FrozenRuleBookMaterial,
  policy: FrozenLiveBidPolicy,
): { ok: true } | { ok: false; code: string } {
  const parsed = BidOpportunityPoolsSchema.safeParse(
    policy.annualOperations?.opportunityPools ?? [],
  );
  if (!parsed.success) return { ok: false, code: 'OPPORTUNITY_POOL_DEFINITION_INVALID' };
  const positions = new Map(material.positions.map((position) => [position.id, position]));
  const rules = new Map(material.rules.map((rule) => [rule.positionId, rule]));
  for (const pool of parsed.data) {
    let signature: string | null = null;
    for (const id of pool.positionIds) {
      const position = positions.get(id);
      const raw = rules.get(id);
      const rule = raw ? decodePositionRule(raw) : null;
      if (
        !position ||
        position.isExcludedFromCount ||
        position.bidParticipation !== 'BIDDABLE' ||
        !rule?.ok
      )
        return { ok: false, code: 'OPPORTUNITY_POOL_SLOT_UNAVAILABLE' };
      const slotSignature = canonical({
        shift: position.shift,
        rank: position.rankRequired,
        station: pool.kind === 'STATION_POOL' ? position.station : null,
        division: position.division ?? null,
        requirements: rule.rule.requiredCriteria,
        points: rule.rule.pointsPreference,
        tieBreak: rule.rule.tieBreakChain,
      });
      if (signature !== null && signature !== slotSignature)
        return { ok: false, code: 'OPPORTUNITY_POOL_SLOTS_NOT_EQUIVALENT' };
      signature = slotSignature;
    }
    const scopes = [
      ...policy.stages.map((stage) => stage.opportunityPositionIds),
      ...(policy.annualOperations?.aDay.execution?.constraints ?? []).map(
        (constraint) => constraint.positionIds,
      ),
      ...(policy.annualOperations?.fallbackPolicies ?? []).map((fallback) => fallback.positionIds),
      ...(policy.annualOperations?.assignmentTerms ?? []).map((term) => term.positionIds),
    ];
    if (
      scopes.some((scope) => {
        const count = pool.positionIds.filter((id) => scope.includes(id)).length;
        return count !== 0 && count !== pool.positionIds.length;
      })
    )
      return { ok: false, code: 'OPPORTUNITY_POOL_POLICY_SCOPE_MISMATCH' };
    if (
      policy.annualOperations?.specialties?.some((specialty) =>
        specialty.opportunityPositionIds.some((id) => pool.positionIds.includes(id)),
      )
    )
      return { ok: false, code: 'OPPORTUNITY_POOL_DEDICATED_SPECIALTY_CONFLICT' };
  }
  return { ok: true };
}

export function projectBidOpportunityPools(
  material: FrozenRuleBookMaterial,
  policy: FrozenLiveBidPolicy,
  fills: Readonly<Record<string, unknown>>,
) {
  const validation = validateBidOpportunityPools(material, policy);
  const pools = policy.annualOperations?.opportunityPools ?? [];
  return pools.map((pool) => {
    const open = pool.positionIds.filter((id) => fills[id] === undefined);
    const position = material.positions.find((entry) => entry.id === pool.positionIds[0]);
    return {
      ...pool,
      valid: validation.ok,
      code: validation.ok ? null : validation.code,
      capacity: pool.positionIds.length,
      remaining: open.length,
      resolvedPositionId: validation.ok ? (open[0] ?? null) : null,
      shift: position?.shift ?? null,
    };
  });
}

/** The submitted concrete slot is a stale-safe reservation proposal. Recompute
 * its membership and configured order from frozen material and canonical fills. */
export function resolveBidPoolSelection(input: {
  material: FrozenRuleBookMaterial;
  policy: FrozenLiveBidPolicy;
  fills: Readonly<Record<string, unknown>>;
  positionId: string;
  poolId?: string;
}): { ok: true; pool: BidOpportunityPool | null } | { ok: false; code: string } {
  const validation = validateBidOpportunityPools(input.material, input.policy);
  if (!validation.ok) return validation;
  const pools = input.policy.annualOperations?.opportunityPools ?? [];
  const memberOf = pools.find((pool) => pool.positionIds.includes(input.positionId));
  if (input.poolId === undefined)
    return memberOf
      ? { ok: false, code: 'OPPORTUNITY_POOL_SELECTION_REQUIRED' }
      : { ok: true, pool: null };
  const pool = pools.find((entry) => entry.id === input.poolId);
  if (!pool || pool.id !== memberOf?.id)
    return { ok: false, code: 'OPPORTUNITY_POOL_SLOT_MISMATCH' };
  const next = pool.positionIds.find((id) => input.fills[id] === undefined);
  if (!next) return { ok: false, code: 'OPPORTUNITY_POOL_FULL' };
  if (next !== input.positionId) return { ok: false, code: 'OPPORTUNITY_POOL_RESERVATION_STALE' };
  return { ok: true, pool };
}
