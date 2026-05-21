import { describe, expect, it } from 'vitest';
import {
  type DbBidRow,
  type Fill,
  mergeFills,
  resolveCurrentBidderId,
  resolvePhase,
} from '../../src/lib/board-merge.js';

describe('mergeFills', () => {
  it('returns an empty object when both inputs are empty', () => {
    expect(mergeFills(undefined, [])).toEqual({});
    expect(mergeFills({}, [])).toEqual({});
  });

  it('returns the DO fills verbatim when D1 has no rows', () => {
    const doFills: Record<string, Fill> = {
      A101: { memberId: 1, ordinal: 1, bidId: 'do1' },
    };
    expect(mergeFills(doFills, [])).toEqual(doFills);
  });

  it('inserts D1 bids that the DO has not seen', () => {
    const dbRows: DbBidRow[] = [{ id: 'db1', memberId: 7, positionId: 'A201', ordinal: 3 }];
    const result = mergeFills({}, dbRows);
    expect(result).toEqual({
      A201: { memberId: 7, ordinal: 3, bidId: 'db1' },
    });
  });

  it('lets D1 win on position conflict — committed bids are durable', () => {
    const doFills: Record<string, Fill> = {
      A101: { memberId: 1, ordinal: 1, bidId: 'pending' },
    };
    const dbRows: DbBidRow[] = [{ id: 'committed', memberId: 1, positionId: 'A101', ordinal: 1 }];
    const result = mergeFills(doFills, dbRows);
    expect(result.A101?.bidId).toBe('committed');
  });

  it('combines disjoint DO + D1 fills (rehearsal auto-bid scenario)', () => {
    const doFills: Record<string, Fill> = {
      A101: { memberId: 1, ordinal: 1, bidId: 'do1' },
    };
    const dbRows: DbBidRow[] = [
      { id: 'autoBid1', memberId: 2, positionId: 'A201', ordinal: 2 },
      { id: 'autoBid2', memberId: 3, positionId: 'A301', ordinal: 3 },
    ];
    const result = mergeFills(doFills, dbRows);
    expect(Object.keys(result).sort()).toEqual(['A101', 'A201', 'A301']);
  });
});

describe('resolvePhase', () => {
  it('returns D1 phase when it has progressed past config', () => {
    expect(resolvePhase('config', 'position_bid')).toBe('position_bid');
    expect(resolvePhase('config', 'a_day_bid')).toBe('a_day_bid');
    expect(resolvePhase('config', 'complete')).toBe('complete');
  });

  it('falls back to DO phase when D1 is still in config', () => {
    expect(resolvePhase('position_bid', 'config')).toBe('position_bid');
  });

  it('falls back to DO phase when D1 row is missing', () => {
    expect(resolvePhase('position_bid', null)).toBe('position_bid');
  });

  it('defaults to "config" when both sources are unusable', () => {
    expect(resolvePhase(undefined, null)).toBe('config');
    expect(resolvePhase(null, null)).toBe('config');
    expect(resolvePhase(42, null)).toBe('config');
  });
});

describe('resolveCurrentBidderId', () => {
  it('returns D1 currentBidderId when set (admin-side advance scenario)', () => {
    expect(resolveCurrentBidderId(null, 13)).toBe(13);
    expect(resolveCurrentBidderId(99, 13)).toBe(13);
  });

  it('falls back to DO value when D1 is null', () => {
    expect(resolveCurrentBidderId(99, null)).toBe(99);
  });

  it('returns null when neither has a value', () => {
    expect(resolveCurrentBidderId(null, null)).toBeNull();
    expect(resolveCurrentBidderId(undefined, null)).toBeNull();
  });

  it('ignores non-number DO values', () => {
    expect(resolveCurrentBidderId('13' as unknown as number, null)).toBeNull();
  });
});
