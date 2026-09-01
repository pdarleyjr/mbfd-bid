import { describe, expect, it } from 'vitest';
import { createFederationState, validateFederationState } from '../../lib/federation-state';

describe('Bid federation state', () => {
  it('creates a cryptographically random transaction accepted only with the matching callback state', () => {
    const issued = createFederationState(1_800_000_000_000);

    expect(issued.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(validateFederationState(issued.cookieValue, issued.state, 1_800_000_001_000)).toBe(true);
    expect(validateFederationState(issued.cookieValue, `${issued.state}A`, 1_800_000_001_000)).toBe(
      false,
    );
    expect(validateFederationState(null, issued.state, 1_800_000_001_000)).toBe(false);
  });

  it('rejects expired and replayed state', () => {
    const issued = createFederationState(1_800_000_000_000);

    expect(validateFederationState(issued.cookieValue, issued.state, 1_800_300_001_000)).toBe(
      false,
    );
    expect(validateFederationState(null, issued.state, 1_800_000_001_000)).toBe(false);
  });
});
