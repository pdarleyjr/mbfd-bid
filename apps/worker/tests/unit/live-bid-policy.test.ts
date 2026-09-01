import type { BidSessionPolicySnapshot, FrozenLiveBidPolicy } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  computeFrozenStageOrder,
  isPositionAllowedForCurrentStage,
} from '../../src/lib/live-bid-policy.js';

const snapshot = {
  v: 3,
  members: [
    { memberId: 1, pool: 'FF', rscSeniority: 20, rankSeniority: null },
    { memberId: 2, pool: 'FF', rscSeniority: 10, rankSeniority: null },
    { memberId: 3, pool: 'EXCLUDED', rscSeniority: 1, rankSeniority: null },
  ],
} as unknown as BidSessionPolicySnapshot;

const policy = {
  v: 1,
  policyRevision: 'test',
  stages: [
    {
      id: 'LT',
      label: 'Lieutenant',
      order: 2,
      memberIds: [1],
      opportunityPositionIds: ['A102'],
      kind: 'LIEUTENANT',
    },
    {
      id: 'FF',
      label: 'Firefighter',
      order: 1,
      memberIds: [2],
      opportunityPositionIds: ['A101'],
      kind: 'FIREFIGHTER',
    },
  ],
} as unknown as FrozenLiveBidPolicy;

describe('frozen live stages', () => {
  it('uses explicit stage ordering and immutable within-stage seniority', () => {
    expect(computeFrozenStageOrder(snapshot, policy)).toEqual({
      ok: true,
      entries: [
        { ordinal: 1, memberId: 2, stageId: 'FF' },
        { ordinal: 2, memberId: 1, stageId: 'LT' },
      ],
    });
  });

  it('fails closed for missing coverage and never makes a reserved position an opportunity', () => {
    expect(computeFrozenStageOrder(snapshot, null)).toEqual({
      ok: false,
      code: 'live_policy_missing',
    });
    expect(isPositionAllowedForCurrentStage(policy, 'FF', 'RESERVED-01')).toBe(false);
    expect(isPositionAllowedForCurrentStage(policy, 'FF', 'A101')).toBe(true);
  });

  it('rejects a supposedly unique seniority tie rather than using member-id order', () => {
    const tied = {
      ...snapshot,
      members: [
        { memberId: 1, pool: 'FF', rscSeniority: 10, rankSeniority: null },
        { memberId: 2, pool: 'FF', rscSeniority: 10, rankSeniority: null },
      ],
    } as unknown as BidSessionPolicySnapshot;
    const oneStage = {
      ...policy,
      stages: [
        {
          id: 'D_CAPTAIN',
          label: 'D Captain',
          order: 0,
          memberIds: [1, 2],
          opportunityPositionIds: ['A101'],
          kind: 'CAPTAIN',
        },
      ],
    } as unknown as FrozenLiveBidPolicy;
    expect(computeFrozenStageOrder(tied, oneStage)).toEqual({
      ok: false,
      code: 'stage_seniority_tie',
    });
  });
});
