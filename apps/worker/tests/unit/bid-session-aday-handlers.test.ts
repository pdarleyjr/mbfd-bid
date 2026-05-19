import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import {
  handleSubmitADayPick,
  transitionToPhase2,
} from '../../src/durable/bid-session-aday-handlers.js';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';

const ff = (id: number): Member => ({
  employeeId: String(id),
  firstName: 'F',
  lastName: String(id),
  rank: 'FF',
  rscSeniority: id,
  rankSeniority: id,
  isProbationary: false,
  credentials: [],
});

describe('transitionToPhase2 (Plan 07 Task 11c)', () => {
  it('moves session from position_bid to a_day_bid and seeds aDay state', () => {
    const initial = {
      ...emptyBidSessionState('sess-1'),
      currentPhase: 'position_bid' as const,
      currentBidderId: null,
      bidOrder: [
        { ordinal: 1, memberId: 1, pool: 'FF' as const },
        { ordinal: 2, memberId: 2, pool: 'FF' as const },
      ],
    };
    const next = transitionToPhase2(
      initial,
      {
        members: [ff(1), ff(2)],
        phase1Order: [1, 2],
        phase1Picks: [
          { memberId: 1, positionId: 'A101', shift: 'A' },
          { memberId: 2, positionId: 'A105', shift: 'A' },
        ],
      },
      1_700_000_000_000,
    );
    expect(next.currentPhase).toBe('a_day_bid');
    expect(next.currentBidderId).toBe(1);
    expect(next.aDay).not.toBeNull();
    expect(next.aDay?.bidOrder).toEqual([1, 2]);
    expect(next.aDay?.cursor).toBe(0);
    expect(next.lastSeq).toBe(initial.lastSeq + 1);
  });

  it('transitions directly to complete if bid order is empty (no eligible bidders)', () => {
    const initial = {
      ...emptyBidSessionState('sess-2'),
      currentPhase: 'position_bid' as const,
    };
    const next = transitionToPhase2(
      initial,
      {
        members: [],
        phase1Order: [],
        phase1Picks: [],
      },
      1_700_000_000_000,
    );
    expect(next.currentPhase).toBe('complete');
    expect(next.currentBidderId).toBeNull();
  });
});

describe('handleSubmitADayPick (Plan 07 Task 12)', () => {
  const lt = (id: number): Member => ({
    employeeId: String(id),
    firstName: 'L',
    lastName: String(id),
    rank: 'LT',
    rscSeniority: id,
    rankSeniority: id,
    isProbationary: false,
    credentials: [],
  });

  // 20 officers on A-shift to satisfy the look-ahead invariant (5 per group × 4 groups).
  // A FF pick to G1 leaves the full 20-officer shortfall to be covered by remaining
  // bidders on the same shift.
  const officersA = Array.from({ length: 20 }, (_, i) => lt(100 + i));
  const officerPicks = officersA.map((m) => ({
    memberId: Number(m.employeeId),
    positionId: 'A105',
    shift: 'A' as const,
  }));
  const allMembers = [ff(1), ff(2), ...officersA];

  function makePhase2State() {
    const initial = {
      ...emptyBidSessionState('sess-3'),
      currentPhase: 'position_bid' as const,
    };
    return transitionToPhase2(
      initial,
      {
        members: allMembers,
        phase1Order: [1, ...officerPicks.map((p) => p.memberId), 2],
        phase1Picks: [
          { memberId: 1, positionId: 'A101', shift: 'A' },
          ...officerPicks,
          { memberId: 2, positionId: 'D101', shift: 'D' },
        ],
      },
      1_700_000_000_000,
    );
  }

  it('rejects when not in a_day_bid phase', () => {
    const state = emptyBidSessionState('sess-x');
    const r = handleSubmitADayPick(
      state,
      {
        senderMemberId: 1,
        aDay: 'G1',
        idempotencyKey: 'k',
        members: [ff(1)],
      },
      1_700_000_001_000,
    );
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.code).toBe('PHASE_NOT_A_DAY_BID');
  });

  it('rejects when not the current bidder', () => {
    const state = makePhase2State();
    const r = handleSubmitADayPick(
      state,
      {
        senderMemberId: 2,
        aDay: 'G1',
        idempotencyKey: 'k',
        members: allMembers,
      },
      1_700_000_001_000,
    );
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.code).toBe('NOT_YOUR_TURN');
  });

  it('accepts a valid Phase 2 pick and advances the cursor', () => {
    const state = makePhase2State();
    const r = handleSubmitADayPick(
      state,
      {
        senderMemberId: 1,
        aDay: 'G1',
        idempotencyKey: 'k1',
        members: allMembers,
      },
      1_700_000_001_000,
    );
    expect(r.kind).toBe('accepted');
    if (r.kind === 'accepted') {
      expect(r.pick.shift).toBe('A');
      expect(r.pick.aDay).toBe('G1');
      expect(r.newState.currentPhase).toBe('a_day_bid');
      // After member 1 picks, the next bidder is the first officer (100).
      expect(r.newState.currentBidderId).toBe(100);
    }
  });

  it('rejects an invalid A-Day for the shift', () => {
    const state = makePhase2State();
    const r = handleSubmitADayPick(
      state,
      {
        senderMemberId: 1,
        aDay: 'MON', // A-shift cannot pick weekday
        idempotencyKey: 'k2',
        members: allMembers,
      },
      1_700_000_001_000,
    );
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.code).toBe('INVALID_A_DAY_FOR_SHIFT');
  });

  it('forced=true bypasses NOT_YOUR_TURN check', () => {
    const state = makePhase2State();
    const r = handleSubmitADayPick(
      state,
      {
        senderMemberId: 2,
        aDay: 'FRI',
        idempotencyKey: 'k3',
        members: allMembers,
        forced: true,
        adminActorId: 99,
        reason: 'admin override',
      },
      1_700_000_001_000,
    );
    expect(r.kind).toBe('accepted');
    if (r.kind === 'accepted') {
      expect(r.pick.forced).toBe(true);
      expect(r.pick.adminActorId).toBe(99);
    }
  });
});
