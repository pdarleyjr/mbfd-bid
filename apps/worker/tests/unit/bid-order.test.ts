import { describe, expect, it } from 'vitest';
import { type BidOrderInputMember, computeBidOrder } from '../../src/lib/bid-order.js';

const m = (
  id: number,
  rsc: number,
  rankSen: number | undefined,
  bidCategory: 'OFC' | 'FF' | 'EXCLUDED' = 'OFC',
): BidOrderInputMember => ({
  id,
  bidCategory,
  rscSeniority: rsc,
  rankSeniority: rankSen ?? null,
});

describe('computeBidOrder (Plan 04 Task 3)', () => {
  it('returns empty array for empty input', () => {
    expect(computeBidOrder([])).toEqual([]);
  });

  it('orders OFC pool before FF pool', () => {
    const order = computeBidOrder([m(1, 50, 1, 'FF'), m(2, 100, 1, 'OFC'), m(3, 200, 1, 'OFC')]);
    expect(order.map((r) => r.memberId)).toEqual([2, 3, 1]);
    expect(order[0]?.pool).toBe('OFC');
    expect(order[2]?.pool).toBe('FF');
  });

  it('sorts within pool by rscSeniority ascending (lower = more senior)', () => {
    const order = computeBidOrder([m(1, 10, 1, 'OFC'), m(2, 5, 1, 'OFC'), m(3, 7, 1, 'OFC')]);
    expect(order.map((r) => r.memberId)).toEqual([2, 3, 1]);
  });

  it('uses rankSeniority as tie-break when rscSeniority is equal', () => {
    const order = computeBidOrder([m(1, 5, 9, 'OFC'), m(2, 5, 1, 'OFC'), m(3, 5, 4, 'OFC')]);
    expect(order.map((r) => r.memberId)).toEqual([2, 3, 1]);
  });

  it('puts members with undefined rankSeniority last in their tie', () => {
    const order = computeBidOrder([m(1, 5, undefined, 'OFC'), m(2, 5, 2, 'OFC')]);
    expect(order.map((r) => r.memberId)).toEqual([2, 1]);
  });

  it('omits EXCLUDED members entirely', () => {
    const order = computeBidOrder([m(1, 1, 1, 'OFC'), m(2, 2, 1, 'EXCLUDED'), m(3, 3, 1, 'FF')]);
    expect(order.map((r) => r.memberId)).toEqual([1, 3]);
  });

  it('ordinal starts at 1 and is contiguous', () => {
    const order = computeBidOrder([m(1, 1, 1, 'OFC'), m(2, 2, 1, 'OFC'), m(3, 3, 1, 'FF')]);
    expect(order.map((r) => r.ordinal)).toEqual([1, 2, 3]);
  });
});
