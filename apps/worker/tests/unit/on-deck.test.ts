import { describe, expect, it } from 'vitest';
import { type BidOrderEntry, computeOnDeck } from '../../src/lib/on-deck.js';

const order: BidOrderEntry[] = [
  { ordinal: 1, memberId: 101, pool: 'OFC' },
  { ordinal: 2, memberId: 102, pool: 'OFC' },
  { ordinal: 3, memberId: 103, pool: 'OFC' },
  { ordinal: 4, memberId: 104, pool: 'FF' },
  { ordinal: 5, memberId: 105, pool: 'FF' },
  { ordinal: 6, memberId: 106, pool: 'FF' },
  { ordinal: 7, memberId: 107, pool: 'FF' },
];

describe('computeOnDeck', () => {
  it('returns the next 5 bidders after the current one', () => {
    const result = computeOnDeck(order, 102, new Set());
    expect(result.map((e) => e.memberId)).toEqual([103, 104, 105, 106, 107]);
  });

  it('returns fewer than 5 when the queue tail is shorter', () => {
    const result = computeOnDeck(order, 105, new Set());
    expect(result.map((e) => e.memberId)).toEqual([106, 107]);
  });

  it('returns the head of the queue when no current bidder is set', () => {
    const result = computeOnDeck(order, null, new Set());
    expect(result.map((e) => e.memberId)).toEqual([101, 102, 103, 104, 105]);
  });

  it('skips members who have already been filled', () => {
    const result = computeOnDeck(order, 101, new Set([103, 105]));
    expect(result.map((e) => e.memberId)).toEqual([102, 104, 106, 107]);
  });

  it('returns [] for an empty bid order', () => {
    expect(computeOnDeck([], 0, new Set())).toEqual([]);
  });

  it('respects a custom count limit', () => {
    const result = computeOnDeck(order, 101, new Set(), 2);
    expect(result.map((e) => e.memberId)).toEqual([102, 103]);
  });

  it('returns [] when the current bidder is past the end of the order', () => {
    const result = computeOnDeck(order, 107, new Set());
    expect(result).toEqual([]);
  });
});
