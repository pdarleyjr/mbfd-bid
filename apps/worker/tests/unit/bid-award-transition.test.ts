import { describe, expect, it } from 'vitest';

import {
  type BidAwardTransitionInput,
  planBidAwardTransition,
} from '../../src/lib/bid-award-transition.js';

function input(overrides: Partial<BidAwardTransitionInput> = {}): BidAwardTransitionInput {
  return {
    session: {
      id: 'completed-session-2030',
      phase: 'complete',
      isMock: false,
      awardsFrozen: true,
    },
    expectedPositionIds: ['B102', 'A101'],
    awards: [
      {
        id: 'award-2',
        bidSessionId: 'completed-session-2030',
        positionId: 'B102',
        memberId: 102,
        ordinal: 2,
        status: 'awarded',
      },
      {
        id: 'award-1',
        bidSessionId: 'completed-session-2030',
        positionId: 'A101',
        memberId: 101,
        ordinal: 1,
        status: 'awarded',
      },
    ],
    bindings: [
      {
        positionId: 'B102',
        staffingPositionId: 'slot-new-b',
        approvalStatus: 'approved',
        targetStatus: 'active',
      },
      {
        positionId: 'A101',
        staffingPositionId: 'slot-new-a',
        approvalStatus: 'approved',
        targetStatus: 'active',
      },
    ],
    assignments: [
      {
        id: 'current-102',
        memberId: 102,
        staffingPositionId: 'slot-old-b',
        status: 'active',
        effectiveFrom: '2029-01-01',
        effectiveTo: null,
      },
      {
        id: 'current-101',
        memberId: 101,
        staffingPositionId: 'slot-old-a',
        status: 'active',
        effectiveFrom: '2029-01-01',
        effectiveTo: null,
      },
    ],
    asOfDate: '2030-01-01',
    effectiveOn: '2030-01-15',
    ...overrides,
  };
}

function expectPlan(result: ReturnType<typeof planBidAwardTransition>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected plan, got ${result.error}`);
  return result;
}

describe('post-Bid award transition planner', () => {
  it("creates only future BID_AWARD assignments and closes prior valid assignments at the boundary without changing today's roster", () => {
    const request = input();
    const originalAssignments = JSON.parse(JSON.stringify(request.assignments));
    const plan = expectPlan(planBidAwardTransition(request));

    expect(request.assignments).toEqual(originalAssignments);
    expect(plan.assignmentClosures).toEqual([
      {
        id: 'current-101',
        memberId: 101,
        staffingPositionId: 'slot-old-a',
        status: 'active',
        effectiveTo: '2030-01-14',
      },
      {
        id: 'current-102',
        memberId: 102,
        staffingPositionId: 'slot-old-b',
        status: 'active',
        effectiveTo: '2030-01-14',
      },
    ]);
    expect(plan.plannedAssignments).toEqual([
      {
        id: null,
        awardId: 'award-1',
        bidSessionId: 'completed-session-2030',
        memberId: 101,
        positionId: 'A101',
        staffingPositionId: 'slot-new-a',
        originType: 'BID_AWARD',
        originRef: 'bid-award:completed-session-2030:award-1',
        status: 'planned',
        effectiveFrom: '2030-01-15',
        effectiveTo: null,
      },
      {
        id: null,
        awardId: 'award-2',
        bidSessionId: 'completed-session-2030',
        memberId: 102,
        positionId: 'B102',
        staffingPositionId: 'slot-new-b',
        originType: 'BID_AWARD',
        originRef: 'bid-award:completed-session-2030:award-2',
        status: 'planned',
        effectiveFrom: '2030-01-15',
        effectiveTo: null,
      },
    ]);
    expect(plan.currentToNew).toEqual([
      {
        ordinal: 1,
        awardId: 'award-1',
        memberId: 101,
        positionId: 'A101',
        currentAssignment: {
          id: 'current-101',
          staffingPositionId: 'slot-old-a',
          status: 'active',
          effectiveFrom: '2029-01-01',
          effectiveTo: null,
        },
        newAssignment: {
          staffingPositionId: 'slot-new-a',
          effectiveFrom: '2030-01-15',
          originRef: 'bid-award:completed-session-2030:award-1',
          status: 'planned',
        },
      },
      {
        ordinal: 2,
        awardId: 'award-2',
        memberId: 102,
        positionId: 'B102',
        currentAssignment: {
          id: 'current-102',
          staffingPositionId: 'slot-old-b',
          status: 'active',
          effectiveFrom: '2029-01-01',
          effectiveTo: null,
        },
        newAssignment: {
          staffingPositionId: 'slot-new-b',
          effectiveFrom: '2030-01-15',
          originRef: 'bid-award:completed-session-2030:award-2',
          status: 'planned',
        },
      },
    ]);
  });

  it('rejects a mock session and a session whose frozen award set is incomplete', () => {
    expect(
      planBidAwardTransition(
        input({ session: { ...input().session, id: 'mock-2030', isMock: true } }),
      ),
    ).toEqual({ ok: false, error: 'mock_session_not_transitionable' });

    expect(
      planBidAwardTransition(input({ expectedPositionIds: ['A101', 'B102', 'C103'] })),
    ).toEqual({ ok: false, error: 'incomplete_frozen_awards' });
  });

  it('rejects duplicate awards and ambiguous bindings rather than choosing a winner or target', () => {
    const base = input();
    const firstAward = base.awards[0];
    if (firstAward === undefined) throw new Error('test fixture must contain an award');
    expect(
      planBidAwardTransition({
        ...base,
        awards: [
          ...base.awards,
          { ...firstAward, id: 'award-duplicate', memberId: 103, ordinal: 3 },
        ],
      }),
    ).toEqual({ ok: false, error: 'duplicate_award_position' });

    expect(
      planBidAwardTransition({
        ...base,
        bindings: [
          ...base.bindings,
          {
            positionId: 'A101',
            staffingPositionId: 'slot-other-a',
            approvalStatus: 'approved',
            targetStatus: 'active',
          },
        ],
      }),
    ).toEqual({ ok: false, error: 'ambiguous_position_binding' });
  });

  it('rejects invalid effective dates, occupied targets, and existing temporal overlaps', () => {
    expect(planBidAwardTransition(input({ effectiveOn: '2030-02-30' }))).toEqual({
      ok: false,
      error: 'invalid_effective_on',
    });
    expect(planBidAwardTransition(input({ effectiveOn: '2030-01-01' }))).toEqual({
      ok: false,
      error: 'effective_on_must_be_future',
    });

    const retiredTarget = input();
    expect(
      planBidAwardTransition({
        ...retiredTarget,
        bindings: retiredTarget.bindings.map((binding) =>
          binding.positionId === 'A101' ? { ...binding, targetStatus: 'retired' } : binding,
        ),
      }),
    ).toEqual({ ok: false, error: 'invalid_target_position' });

    const occupied = input();
    expect(
      planBidAwardTransition({
        ...occupied,
        assignments: [
          ...occupied.assignments,
          {
            id: 'target-occupant',
            memberId: 999,
            staffingPositionId: 'slot-new-a',
            status: 'active',
            effectiveFrom: '2029-01-01',
            effectiveTo: null,
          },
        ],
      }),
    ).toEqual({ ok: false, error: 'target_occupied_at_effective_on' });

    const overlapping = input();
    expect(
      planBidAwardTransition({
        ...overlapping,
        assignments: [
          ...overlapping.assignments,
          {
            id: 'overlapping-101',
            memberId: 101,
            staffingPositionId: 'slot-overlap',
            status: 'active',
            effectiveFrom: '2029-06-01',
            effectiveTo: null,
          },
        ],
      }),
    ).toEqual({ ok: false, error: 'member_assignment_temporal_overlap' });
  });

  it('returns a deterministic JSON-roundtrippable plan regardless of input row order', () => {
    const base = input();
    const plan = expectPlan(planBidAwardTransition(base));
    const reordered = expectPlan(
      planBidAwardTransition({
        ...base,
        expectedPositionIds: [...base.expectedPositionIds].reverse(),
        awards: [...base.awards].reverse(),
        bindings: [...base.bindings].reverse(),
        assignments: [...base.assignments].reverse(),
      }),
    );

    expect(reordered).toEqual(plan);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});
