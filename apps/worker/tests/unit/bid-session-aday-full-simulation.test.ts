// apps/worker/tests/unit/bid-session-aday-full-simulation.test.ts
//
// Plan 07 Task 16: end-to-end simulation of Phase 1 → Phase 2 → complete
// across a realistic 12-member roster. Asserts:
//   1. Phase 2 transitions correctly after Phase 1 completes.
//   2. Each member gets exactly one A-Day pick.
//   3. Custom small-pool capacity caps are respected.
//   4. Vacant Phase 1 positions are ignored by the Phase 2 bid order.

import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import {
  handleSubmitADayPick,
  transitionToPhase2,
} from '../../src/durable/bid-session-aday-handlers.js';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';

function mkMember(
  id: number,
  rank: 'CPT' | 'LT' | 'FF',
  shift: 'A' | 'B' | 'C' | 'D',
): Member & { __shift: 'A' | 'B' | 'C' | 'D' } {
  return {
    employeeId: String(id),
    firstName: 'M',
    lastName: String(id),
    rank,
    rscSeniority: id,
    rankSeniority: id,
    isProbationary: false,
    credentials: [],
    __shift: shift,
  };
}

describe('Plan 07 Task 16: 12-member end-to-end simulation', () => {
  it('runs Phase 1 → Phase 2 → complete with realistic rank distribution', () => {
    // 12 members: 5 on A-shift (1 CPT + 1 LT + 3 FF), 5 on B-shift (1 LT + 4 FF),
    // 2 on D-shift (2 FF). Use small group caps so 12 members satisfy the invariant.
    const aMembers = [
      mkMember(1, 'CPT', 'A'),
      mkMember(2, 'LT', 'A'),
      mkMember(3, 'FF', 'A'),
      mkMember(4, 'FF', 'A'),
      mkMember(5, 'FF', 'A'),
    ];
    const bMembers = [
      mkMember(6, 'LT', 'B'),
      mkMember(7, 'LT', 'B'),
      mkMember(8, 'FF', 'B'),
      mkMember(9, 'FF', 'B'),
      mkMember(10, 'FF', 'B'),
    ];
    const dMembers = [mkMember(11, 'FF', 'D'), mkMember(12, 'FF', 'D')];
    const allMembers = [...aMembers, ...bMembers, ...dMembers];

    // Phase 1 picks: every member fills a position on their shift.
    const phase1Picks = allMembers.map((m) => ({
      memberId: Number(m.employeeId),
      positionId: `${m.__shift}1${String(m.employeeId).padStart(2, '0')}`,
      shift: m.__shift,
    }));

    // Small caps tuned for the 12-member pool. A-shift: G1 holds 3 (incl. 1 officer),
    // G2 holds 2 (incl. 1 officer). G3/G4 zero. Same for B. D has no caps.
    const tightCaps = {
      A: {
        G1: { min: 3, max: 3, officersRequired: 1 },
        G2: { min: 2, max: 2, officersRequired: 1 },
        G3: { min: 0, max: 0, officersRequired: 0 },
        G4: { min: 0, max: 0, officersRequired: 0 },
      },
      B: {
        G1: { min: 3, max: 3, officersRequired: 1 },
        G2: { min: 2, max: 2, officersRequired: 1 },
        G3: { min: 0, max: 0, officersRequired: 0 },
        G4: { min: 0, max: 0, officersRequired: 0 },
      },
      C: {
        G1: { min: 0, max: 0, officersRequired: 0 },
        G2: { min: 0, max: 0, officersRequired: 0 },
        G3: { min: 0, max: 0, officersRequired: 0 },
        G4: { min: 0, max: 0, officersRequired: 0 },
      },
    } as const;

    const initial = {
      ...emptyBidSessionState('sess-sim'),
      currentPhase: 'position_bid' as const,
    };
    let state = transitionToPhase2(
      initial,
      {
        members: allMembers,
        phase1Order: allMembers.map((m) => Number(m.employeeId)),
        phase1Picks,
        groupCaps: tightCaps,
      },
      1_700_000_000_000,
    );
    expect(state.currentPhase).toBe('a_day_bid');
    expect(state.aDay?.bidOrder.length).toBe(12);

    // Pre-plan A-Day assignments so the invariant is satisfied at the end:
    // A-shift: CPT (1) → G1 officer, LT (2) → G2 officer, FFs (3,4,5) → G1, G1, G2.
    // B-shift: LT (6) → G1 officer, LT (7) → G2 officer, FFs (8,9,10) → G1, G1, G2.
    // D-shift: 11 → MON, 12 → FRI.
    const plan: Record<number, 'G1' | 'G2' | 'MON' | 'FRI'> = {
      1: 'G1',
      2: 'G2',
      3: 'G1',
      4: 'G1',
      5: 'G2',
      6: 'G1',
      7: 'G2',
      8: 'G1',
      9: 'G1',
      10: 'G2',
      11: 'MON',
      12: 'FRI',
    };

    // Iterate through the cursor, picking each member's pre-planned A-Day.
    let nowMs = 1_700_000_001_000;
    while (state.currentPhase === 'a_day_bid') {
      const bidderId = state.currentBidderId;
      if (bidderId === null) break;
      const aDay = plan[bidderId];
      if (!aDay) throw new Error(`no plan for member ${bidderId}`);
      const r = handleSubmitADayPick(
        state,
        {
          senderMemberId: bidderId,
          aDay,
          idempotencyKey: `k-${bidderId}`,
          members: allMembers,
        },
        nowMs++,
      );
      if (r.kind !== 'accepted') {
        throw new Error(`member ${bidderId} pick ${aDay} rejected: ${r.code}`);
      }
      state = r.newState;
    }

    // 1. Phase 2 completed cleanly.
    expect(state.currentPhase).toBe('complete');
    expect(state.currentBidderId).toBeNull();

    // 2. Every member has a pick (persisted form keeps `picks` array, not Map).
    expect(state.aDay?.picks.length).toBe(12);

    // 3. Tally by (shift, aDay) and confirm caps + officer counts.
    const byShiftGroup: Record<string, { total: number; officers: number }> = {};
    for (const pick of state.aDay?.picks ?? []) {
      const key = `${pick.shift}:${pick.aDay}`;
      const entry = byShiftGroup[key] ?? { total: 0, officers: 0 };
      entry.total++;
      const member = allMembers.find((m) => Number(m.employeeId) === pick.memberId);
      if (member && (member.rank === 'CPT' || member.rank === 'LT' || member.rank === 'DC')) {
        entry.officers++;
      }
      byShiftGroup[key] = entry;
    }
    // A-shift: G1 = 3 total, 1 officer (CPT). G2 = 2 total, 1 officer (LT).
    expect(byShiftGroup['A:G1']).toEqual({ total: 3, officers: 1 });
    expect(byShiftGroup['A:G2']).toEqual({ total: 2, officers: 1 });
    // B-shift: same pattern.
    expect(byShiftGroup['B:G1']).toEqual({ total: 3, officers: 1 });
    expect(byShiftGroup['B:G2']).toEqual({ total: 2, officers: 1 });
    // D-shift: 1 each on MON and FRI.
    expect(byShiftGroup['D:MON']).toEqual({ total: 1, officers: 0 });
    expect(byShiftGroup['D:FRI']).toEqual({ total: 1, officers: 0 });
  });

  it('vacant Phase 1 positions are excluded from Phase 2 bid order', () => {
    // 5 members, but only 3 have Phase 1 picks (members 4 and 5 are "vacant").
    const allMembers = [
      mkMember(1, 'FF', 'A'),
      mkMember(2, 'FF', 'A'),
      mkMember(3, 'FF', 'A'),
      mkMember(4, 'FF', 'A'),
      mkMember(5, 'FF', 'A'),
    ];
    const phase1Picks = [
      { memberId: 1, positionId: 'A101', shift: 'A' as const },
      { memberId: 2, positionId: 'A102', shift: 'A' as const },
      { memberId: 3, positionId: 'A103', shift: 'A' as const },
    ];
    // Use a tight cap so the invariant works (3 members, no officers needed).
    const tightCaps = {
      A: {
        G1: { min: 3, max: 3, officersRequired: 0 },
        G2: { min: 0, max: 0, officersRequired: 0 },
        G3: { min: 0, max: 0, officersRequired: 0 },
        G4: { min: 0, max: 0, officersRequired: 0 },
      },
      B: {
        G1: { min: 0, max: 0, officersRequired: 0 },
        G2: { min: 0, max: 0, officersRequired: 0 },
        G3: { min: 0, max: 0, officersRequired: 0 },
        G4: { min: 0, max: 0, officersRequired: 0 },
      },
      C: {
        G1: { min: 0, max: 0, officersRequired: 0 },
        G2: { min: 0, max: 0, officersRequired: 0 },
        G3: { min: 0, max: 0, officersRequired: 0 },
        G4: { min: 0, max: 0, officersRequired: 0 },
      },
    } as const;
    const initial = {
      ...emptyBidSessionState('sess-vac'),
      currentPhase: 'position_bid' as const,
    };
    const state = transitionToPhase2(
      initial,
      {
        members: allMembers,
        phase1Order: [1, 2, 3, 4, 5],
        phase1Picks,
        groupCaps: tightCaps,
      },
      1_700_000_000_000,
    );
    expect(state.currentPhase).toBe('a_day_bid');
    expect(state.aDay?.bidOrder.length).toBe(3);
    expect(state.aDay?.bidOrder).toEqual([1, 2, 3]);
  });
});
