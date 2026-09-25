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

  it('does not require an excluded executive member to appear in an ordinary bid stage', () => {
    const withExecutive = {
      ...snapshot,
      members: snapshot.members.map((member) =>
        member.memberId === 3 ? { ...member, rank: 'DC' } : member,
      ),
    } as unknown as BidSessionPolicySnapshot;

    expect(computeFrozenStageOrder(withExecutive, policy)).toMatchObject({ ok: true });
  });

  it('rejects typed provenance without a resolved ordering authority instead of falling back to legacy seniority', () => {
    const pinned = {
      ...snapshot,
      members: [
        { memberId: 1, pool: 'FF', rscSeniority: 1, rankSeniority: 2 },
        { memberId: 2, pool: 'FF', rscSeniority: 2, rankSeniority: 1 },
      ],
    } as unknown as BidSessionPolicySnapshot;
    const authored = {
      ...policy,
      stages: [
        {
          id: 'CAPTAINS',
          label: 'Synthetic captains',
          order: 0,
          memberIds: [1, 2],
          opportunityPositionIds: ['A101'],
          kind: 'CAPTAIN',
          participantProvenance: {
            v: 1,
            stageId: 'CAPTAINS',
            sourceRef: 'synthetic-policy:captain-stage',
            participantSource: {
              type: 'FILTER',
              active: true,
              bidParticipation: 'BIDDABLE',
              ranks: ['CPT'],
            },
            ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
            pinnedEvaluationCapturedAtMs: 1,
            resolvedMemberIds: [1, 2],
          },
        },
      ],
    } as unknown as FrozenLiveBidPolicy;

    expect(computeFrozenStageOrder(pinned, authored)).toEqual({
      ok: false,
      code: 'stage_ordering_authority_unresolved',
    });
  });

  it('honors rank-seniority only when the frozen policy carries the resolved source-decision identity', () => {
    const pinned = {
      ...snapshot,
      members: [
        { memberId: 1, pool: 'FF', rscSeniority: 1, rankSeniority: 2 },
        { memberId: 2, pool: 'FF', rscSeniority: 2, rankSeniority: 1 },
      ],
    } as unknown as BidSessionPolicySnapshot;
    const orderingAuthority = {
      v: 1 as const,
      comparator: [{ key: 'RANK_SENIORITY' as const, direction: 'ASC' as const }],
      sourceDecision: {
        issueId: 'synthetic-governing-ordering-decision',
        effectiveOn: '2027-01-01',
      },
    };
    const authored = {
      ...policy,
      orderingAuthority,
      stages: [
        {
          id: 'CAPTAINS',
          label: 'Synthetic captains',
          order: 0,
          memberIds: [1, 2],
          opportunityPositionIds: ['A101'],
          kind: 'CAPTAIN',
          participantProvenance: {
            v: 1,
            stageId: 'CAPTAINS',
            sourceRef: 'synthetic-policy:captain-stage',
            participantSource: {
              type: 'FILTER',
              active: true,
              bidParticipation: 'BIDDABLE',
              ranks: ['CPT'],
            },
            ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
            orderingAuthority,
            pinnedEvaluationCapturedAtMs: 1,
            resolvedMemberIds: [1, 2],
          },
        },
      ],
    } as unknown as FrozenLiveBidPolicy;

    expect(computeFrozenStageOrder(pinned, authored)).toEqual({
      ok: true,
      entries: [
        { ordinal: 1, memberId: 2, stageId: 'CAPTAINS' },
        { ordinal: 2, memberId: 1, stageId: 'CAPTAINS' },
      ],
    });
  });

  it.each([
    {
      name: 'a missing rank-seniority fact',
      members: [
        { memberId: 1, pool: 'FF', rscSeniority: 1, rankSeniority: null },
        { memberId: 2, pool: 'FF', rscSeniority: 2, rankSeniority: 1 },
      ],
      code: 'stage_ordering_fact_missing',
    },
    {
      name: 'a duplicate authored ordering key',
      members: [
        { memberId: 1, pool: 'FF', rscSeniority: 1, rankSeniority: 1 },
        { memberId: 2, pool: 'FF', rscSeniority: 2, rankSeniority: 1 },
      ],
      code: 'stage_ordering_tie',
    },
  ] as const)('fails closed for $name', ({ members, code }) => {
    const pinned = { ...snapshot, members } as unknown as BidSessionPolicySnapshot;
    const orderingAuthority = {
      v: 1 as const,
      comparator: [{ key: 'RANK_SENIORITY' as const, direction: 'ASC' as const }],
      sourceDecision: {
        issueId: 'synthetic-governing-ordering-decision',
        effectiveOn: '2027-01-01',
      },
    };
    const authored = {
      ...policy,
      orderingAuthority,
      stages: [
        {
          id: 'CAPTAINS',
          label: 'Synthetic captains',
          order: 0,
          memberIds: [1, 2],
          opportunityPositionIds: ['A101'],
          kind: 'CAPTAIN',
          participantProvenance: {
            v: 1,
            stageId: 'CAPTAINS',
            sourceRef: 'synthetic-policy:captain-stage',
            participantSource: {
              type: 'FILTER',
              active: true,
              bidParticipation: 'BIDDABLE',
              ranks: ['CPT'],
            },
            ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
            orderingAuthority,
            pinnedEvaluationCapturedAtMs: 1,
            resolvedMemberIds: [1, 2],
          },
        },
      ],
    } as unknown as FrozenLiveBidPolicy;

    expect(computeFrozenStageOrder(pinned, authored)).toEqual({ ok: false, code });
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
