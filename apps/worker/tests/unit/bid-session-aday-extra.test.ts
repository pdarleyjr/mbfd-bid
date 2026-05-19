import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import {
  dehydrateADayState,
  handleSubmitADayPick,
  hydrateADayState,
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

describe('hydrate/dehydrate round-trip (Plan 07 Task 11b)', () => {
  it('round-trip preserves all fields', () => {
    const initial = {
      ...emptyBidSessionState('sess-rt'),
      currentPhase: 'position_bid' as const,
    };
    const next = transitionToPhase2(
      initial,
      {
        members: [ff(1), ff(2)],
        phase1Order: [1, 2],
        phase1Picks: [
          { memberId: 1, positionId: 'D101', shift: 'D' },
          { memberId: 2, positionId: 'D102', shift: 'D' },
        ],
      },
      1_700_000_000_000,
    );
    expect(next.aDay).not.toBeNull();
    if (!next.aDay) throw new Error('aDay should be set');
    const membersById = new Map<number, Member>([
      [1, ff(1)],
      [2, ff(2)],
    ]);
    const inMemory = hydrateADayState(next.aDay, membersById);
    const roundTripped = dehydrateADayState(inMemory);
    expect(roundTripped.bidOrder).toEqual(next.aDay.bidOrder);
    expect(roundTripped.cursor).toBe(next.aDay.cursor);
    expect(roundTripped.picks.length).toBe(next.aDay.picks.length);
  });
});

describe('D-shift weekday picker (Plan 07 Task 12d)', () => {
  function makeDShiftPhase2(weekdayCaps: Record<string, { max: number | undefined }> = {}) {
    const initial = {
      ...emptyBidSessionState('sess-d'),
      currentPhase: 'position_bid' as const,
    };
    return transitionToPhase2(
      initial,
      {
        members: [ff(1), ff(2), ff(3)],
        phase1Order: [1, 2, 3],
        phase1Picks: [
          { memberId: 1, positionId: 'D101', shift: 'D' },
          { memberId: 2, positionId: 'D102', shift: 'D' },
          { memberId: 3, positionId: 'D103', shift: 'D' },
        ],
        weekdayCaps: weekdayCaps as never,
      },
      1_700_000_000_000,
    );
  }

  it('accepts FRI with no cap by default', () => {
    const state = makeDShiftPhase2();
    const r = handleSubmitADayPick(
      state,
      {
        senderMemberId: 1,
        aDay: 'FRI',
        idempotencyKey: 'k1',
        members: [ff(1), ff(2), ff(3)],
      },
      1_700_000_001_000,
    );
    expect(r.kind).toBe('accepted');
    if (r.kind === 'accepted') expect(r.pick.shift).toBe('D');
  });

  it('rejects FRI when admin cap of 1 already reached', () => {
    const state = makeDShiftPhase2({ FRI: { max: 1 } });
    const after = handleSubmitADayPick(
      state,
      {
        senderMemberId: 1,
        aDay: 'FRI',
        idempotencyKey: 'k1',
        members: [ff(1), ff(2), ff(3)],
      },
      1_700_000_001_000,
    );
    if (after.kind !== 'accepted') throw new Error('first pick should succeed');
    const second = handleSubmitADayPick(
      after.newState,
      {
        senderMemberId: 2,
        aDay: 'FRI',
        idempotencyKey: 'k2',
        members: [ff(1), ff(2), ff(3)],
      },
      1_700_000_002_000,
    );
    expect(second.kind).toBe('rejected');
    if (second.kind === 'rejected') expect(second.code).toBe('WEEKDAY_FULL');
  });
});

describe('Phase 2 completion (Plan 07 Task 12e)', () => {
  it('transitions currentPhase to complete after the last pick', () => {
    const initial = {
      ...emptyBidSessionState('sess-cmp'),
      currentPhase: 'position_bid' as const,
    };
    const state = transitionToPhase2(
      initial,
      {
        members: [ff(1), ff(2)],
        phase1Order: [1, 2],
        phase1Picks: [
          { memberId: 1, positionId: 'D101', shift: 'D' },
          { memberId: 2, positionId: 'D102', shift: 'D' },
        ],
      },
      1_700_000_000_000,
    );

    const r1 = handleSubmitADayPick(
      state,
      {
        senderMemberId: 1,
        aDay: 'FRI',
        idempotencyKey: 'k1',
        members: [ff(1), ff(2)],
      },
      1_700_000_001_000,
    );
    if (r1.kind !== 'accepted') throw new Error('pick 1 should succeed');
    expect(r1.newState.currentPhase).toBe('a_day_bid');

    const r2 = handleSubmitADayPick(
      r1.newState,
      {
        senderMemberId: 2,
        aDay: 'MON',
        idempotencyKey: 'k2',
        members: [ff(1), ff(2)],
      },
      1_700_000_002_000,
    );
    if (r2.kind !== 'accepted') throw new Error('pick 2 should succeed');
    expect(r2.newState.currentPhase).toBe('complete');
    expect(r2.newState.currentBidderId).toBeNull();
    expect(r2.nextMemberId).toBeNull();
  });
});

describe('Officer invariant (Plan 07 Task 12b)', () => {
  it('rejects the 6th officer joining a group of 5', () => {
    // 6 officers all on A-shift; first 5 pick G1 (success); 6th picks G1 (reject).
    const officers = Array.from({ length: 6 }, (_, i) => lt(100 + i));
    // Need 20 officers total on A-shift to satisfy the look-ahead invariant.
    // (5/group × 4 groups = 20). Add 14 more.
    const extras = Array.from({ length: 14 }, (_, i) => lt(200 + i));
    const allMembers = [...officers, ...extras];
    const phase1Picks = allMembers.map((m) => ({
      memberId: Number(m.employeeId),
      positionId: 'A105',
      shift: 'A' as const,
    }));
    const initial = {
      ...emptyBidSessionState('sess-inv'),
      currentPhase: 'position_bid' as const,
    };
    let state = transitionToPhase2(
      initial,
      {
        members: allMembers,
        phase1Order: allMembers.map((m) => Number(m.employeeId)),
        phase1Picks,
      },
      1_700_000_000_000,
    );

    // First 5 officers (100..104) pick G1.
    for (let i = 0; i < 5; i++) {
      const memberId = 100 + i;
      const r = handleSubmitADayPick(
        state,
        {
          senderMemberId: memberId,
          aDay: 'G1',
          idempotencyKey: `k-${memberId}`,
          members: allMembers,
        },
        1_700_000_000_000 + i,
      );
      if (r.kind !== 'accepted') {
        throw new Error(`pick ${i} should have succeeded but got ${r.code}`);
      }
      state = r.newState;
    }
    // 6th officer tries G1 — should reject.
    const sixth = handleSubmitADayPick(
      state,
      {
        senderMemberId: 105,
        aDay: 'G1',
        idempotencyKey: 'k-105',
        members: allMembers,
      },
      1_700_000_000_100,
    );
    expect(sixth.kind).toBe('rejected');
    if (sixth.kind === 'rejected') expect(sixth.code).toBe('OFFICER_INVARIANT_VIOLATED');
  });
});
