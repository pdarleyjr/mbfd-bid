import { describe, expect, it } from 'vitest';
import { shouldForceBidRevalidation } from '../../src/routes/bid.js';

describe('member Bid authorization freshness', () => {
  it('uses bounded freshness only for safe reads', () => {
    expect(shouldForceBidRevalidation('GET')).toBe(false);
    expect(shouldForceBidRevalidation('HEAD')).toBe(false);
    expect(shouldForceBidRevalidation('POST')).toBe(true);
    expect(shouldForceBidRevalidation('PATCH')).toBe(true);
    expect(shouldForceBidRevalidation('DELETE')).toBe(true);
  });
});
