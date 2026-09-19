import {
  BidOpportunityPoolsSchema,
  type FrozenLiveBidPolicy,
  type FrozenRuleBookMaterial,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  projectBidOpportunityPools,
  resolveBidPoolSelection,
  validateBidOpportunityPools,
} from '../src/lib/bid-opportunity-pool.js';

// Synthetic partial policy contains every field this pure capacity validator reads.
function fixture() {
  const pool = {
    id: 'pool',
    label: 'Synthetic station capacity',
    kind: 'STATION_POOL' as const,
    sourceRef: 'Synthetic explicit decision',
    sourceDecisionId: 'reviewed',
    positionIds: ['z-first', 'a-second'],
  };
  const material: FrozenRuleBookMaterial = {
    v: 1,
    positions: pool.positionIds.map((id, i) => ({
      id,
      templateVersion: 'synthetic',
      bidParticipation: 'BIDDABLE',
      isExcludedFromCount: false,
      shift: 'A',
      station: '1',
      division: 'Combat',
      rankRequired: 'FF',
      unit: i === 0 ? 'Synthetic Ladder' : 'Synthetic Engine',
      positionName: `Synthetic slot ${i}`,
    })),
    rules: pool.positionIds.map((positionId) => ({
      positionId,
      templateVersion: 'synthetic',
      ruleBookVersion: 'synthetic',
      requiredCriteriaJson: JSON.stringify({ rank: ['FF'], credentials: [], custom: [] }),
      pointsPreferenceJson: '{"max":0,"items":[]}',
      tieBreakChainJson: '["rsc_seniority"]',
    })),
  };
  const policy = {
    stages: [{ opportunityPositionIds: [...pool.positionIds] }],
    annualOperations: {
      opportunityPools: [pool],
      aDay: {},
      specialties: [],
    },
  } as unknown as FrozenLiveBidPolicy;
  return { material, policy, pool };
}

function item<T>(values: T[], index = 0): T {
  const value = values[index];
  if (value === undefined) throw new Error('Synthetic fixture item missing');
  return value;
}

describe('explicit frozen opportunity pools', () => {
  it('preserves reviewed slot order and ignores daily apparatus labels', () => {
    const { material, policy, pool } = fixture();
    expect(item(BidOpportunityPoolsSchema.parse([pool])).positionIds).toEqual([
      'z-first',
      'a-second',
    ]);
    expect(validateBidOpportunityPools(material, policy)).toEqual({ ok: true });
    expect(projectBidOpportunityPools(material, policy, {})).toMatchObject([
      { resolvedPositionId: 'z-first', remaining: 2 },
    ]);
    expect(projectBidOpportunityPools(material, policy, { 'z-first': {} })).toMatchObject([
      { resolvedPositionId: 'a-second', remaining: 1 },
    ]);
  });
  it('does not infer pools from station or apparatus names', () => {
    const { material, policy } = fixture();
    if (!policy.annualOperations) throw new Error('Synthetic annual policy required');
    policy.annualOperations.opportunityPools = undefined;
    expect(projectBidOpportunityPools(material, policy, {})).toEqual([]);
    expect(resolveBidPoolSelection({ material, policy, fills: {}, positionId: 'z-first' })).toEqual(
      { ok: true, pool: null },
    );
  });
  it('rejects duplicate and overlapping capacity memberships', () => {
    const { pool } = fixture();
    expect(
      BidOpportunityPoolsSchema.safeParse([{ ...pool, positionIds: ['x', 'x'] }]).success,
    ).toBe(false);
    expect(BidOpportunityPoolsSchema.safeParse([pool, { ...pool, id: 'other' }]).success).toBe(
      false,
    );
  });
  it.each(['shift', 'rankRequired', 'station'] as const)('rejects mixed %s slots', (field) => {
    const { material, policy } = fixture();
    Object.assign(item(material.positions, 1), {
      [field]: field === 'shift' ? 'B' : field === 'rankRequired' ? 'LT' : '3',
    });
    expect(validateBidOpportunityPools(material, policy)).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_SLOTS_NOT_EQUIVALENT',
    });
  });
  it('rejects mixed frozen eligibility even when display metadata matches', () => {
    const { material, policy } = fixture();
    item(material.rules, 1).requiredCriteriaJson = JSON.stringify({
      rank: ['FF'],
      credentials: [],
      custom: ['non_probationary'],
    });
    expect(validateBidOpportunityPools(material, policy)).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_SLOTS_NOT_EQUIVALENT',
    });
    expect(item(projectBidOpportunityPools(material, policy, {})).resolvedPositionId).toBeNull();
  });
  it('rejects unavailable rules and closed slots', () => {
    const { material, policy } = fixture();
    material.rules.pop();
    expect(validateBidOpportunityPools(material, policy)).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_SLOT_UNAVAILABLE',
    });
    item(material.positions).bidParticipation = 'RESERVED_NON_BIDDABLE';
    expect(validateBidOpportunityPools(material, policy).ok).toBe(false);
  });
  it('rejects partial stage scopes and dedicated specialties', () => {
    const { material, policy } = fixture();
    item(policy.stages).opportunityPositionIds.pop();
    expect(validateBidOpportunityPools(material, policy)).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_POLICY_SCOPE_MISMATCH',
    });
    item(policy.stages).opportunityPositionIds.push('a-second');
    if (!policy.annualOperations) throw new Error('Synthetic annual policy required');
    policy.annualOperations.specialties = [{ opportunityPositionIds: ['z-first'] }] as NonNullable<
      FrozenLiveBidPolicy['annualOperations']
    >['specialties'];
    expect(validateBidOpportunityPools(material, policy)).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_DEDICATED_SPECIALTY_CONFLICT',
    });
  });
  it('rejects untagged, foreign, stale and exhausted reservations', () => {
    const { material, policy } = fixture();
    const resolve = (positionId: string, poolId?: string, fills = {}) =>
      resolveBidPoolSelection({
        material,
        policy,
        fills,
        positionId,
        ...(poolId === undefined ? {} : { poolId }),
      });
    expect(resolve('z-first')).toEqual({ ok: false, code: 'OPPORTUNITY_POOL_SELECTION_REQUIRED' });
    expect(resolve('z-first', 'foreign')).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_SLOT_MISMATCH',
    });
    expect(resolve('a-second', 'pool')).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_RESERVATION_STALE',
    });
    expect(resolve('z-first', 'pool', { 'z-first': {} })).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_RESERVATION_STALE',
    });
    expect(resolve('a-second', 'pool', { 'z-first': {} }).ok).toBe(true);
    expect(resolve('a-second', 'pool', { 'z-first': {}, 'a-second': {} })).toEqual({
      ok: false,
      code: 'OPPORTUNITY_POOL_FULL',
    });
  });
});
