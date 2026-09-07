import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { phase2BidOrder } from '../../src/order.js';

const m = (id: number, rsc: number): Member => ({
  employeeId: String(id),
  firstName: 'M',
  lastName: String(id),
  rank: 'FF',
  rscSeniority: rsc,
  rankSeniority: rsc,
  isProbationary: false,
  credentials: [],
});

describe('phase2BidOrder — strategy phase_1_order', () => {
  it('returns the phase 1 bid order, filtering out members without phase 1 picks', () => {
    const order = phase2BidOrder({
      strategy: 'phase_1_order',
      phase1Order: [10, 20, 30],
      phase1Picks: [
        { memberId: 10, shift: 'A', positionId: 'A101' },
        { memberId: 30, shift: 'B', positionId: 'B105' },
      ],
      members: [m(10, 1), m(20, 2), m(30, 3)],
      preSeededMemberIds: [],
    });
    expect(order).toEqual([10, 30]);
  });

  it('excludes pre-seeded member ids', () => {
    const order = phase2BidOrder({
      strategy: 'phase_1_order',
      phase1Order: [10, 20, 30],
      phase1Picks: [
        { memberId: 10, shift: 'A', positionId: 'A101' },
        { memberId: 20, shift: 'A', positionId: 'A701' },
        { memberId: 30, shift: 'B', positionId: 'B105' },
      ],
      members: [m(10, 1), m(20, 2), m(30, 3)],
      preSeededMemberIds: [20],
    });
    expect(order).toEqual([10, 30]);
  });
});

describe('phase2BidOrder — strategy by_shift_then_seniority', () => {
  it('excludes missing phase-one or roster evidence and sorts unranked ties last', () => {
    expect(
      phase2BidOrder({
        strategy: 'by_shift_then_seniority',
        phase1Order: [1, 2, 3, 4, 5],
        phase1Picks: [1, 3, 4, 5].map((memberId) => ({
          memberId,
          shift: 'A' as const,
          positionId: `A${memberId}`,
        })),
        members: [{ ...m(1, 10), rankSeniority: undefined }, m(2, 1), m(4, 10), m(5, 1)],
        preSeededMemberIds: [5],
      }),
    ).toEqual([4, 1]);
  });
  it('groups by shift in order A, B, C, D and sorts each by rsc_seniority ascending', () => {
    const order = phase2BidOrder({
      strategy: 'by_shift_then_seniority',
      phase1Order: [50, 10, 30, 20, 40],
      phase1Picks: [
        { memberId: 10, shift: 'C', positionId: 'C101' },
        { memberId: 20, shift: 'A', positionId: 'A105' },
        { memberId: 30, shift: 'B', positionId: 'B105' },
        { memberId: 40, shift: 'D', positionId: 'D101' },
        { memberId: 50, shift: 'A', positionId: 'A101' },
      ],
      members: [m(10, 30), m(20, 10), m(30, 20), m(40, 40), m(50, 5)],
      preSeededMemberIds: [],
    });
    // A: 50 (rsc 5), 20 (rsc 10); B: 30 (rsc 20); C: 10 (rsc 30); D: 40 (rsc 40)
    expect(order).toEqual([50, 20, 30, 10, 40]);
  });

  it('ties on rsc_seniority broken by rankSeniority ascending', () => {
    const ma = (id: number, rsc: number, rank: number): Member => ({
      ...m(id, rsc),
      rankSeniority: rank,
    });
    const order = phase2BidOrder({
      strategy: 'by_shift_then_seniority',
      phase1Order: [10, 20],
      phase1Picks: [
        { memberId: 10, shift: 'A', positionId: 'A101' },
        { memberId: 20, shift: 'A', positionId: 'A105' },
      ],
      members: [ma(10, 5, 10), ma(20, 5, 3)],
      preSeededMemberIds: [],
    });
    expect(order).toEqual([20, 10]);
  });
});
