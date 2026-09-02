import { describe, expect, it } from 'vitest';
import {
  createFederationState,
  safeLocalReturnPath,
  validateFederationState,
} from '../../lib/federation-state';

describe('Bid federation state', () => {
  it('creates a cryptographically random signed transaction accepted only with the matching callback state', async () => {
    const key = 'A'.repeat(64);
    const issued = await createFederationState(key, '/admin', 1_800_000_000);

    expect(issued.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(validateFederationState(issued.cookieValue, issued.state, key)).resolves.toEqual({
      returnTo: '/admin',
    });
    await expect(
      validateFederationState(issued.cookieValue, `${issued.state}A`, key),
    ).resolves.toBeNull();
    await expect(validateFederationState(null, issued.state, key)).resolves.toBeNull();
  });

  it('rejects a forged return target and unsafe local return paths', async () => {
    const key = 'A'.repeat(64);
    const issued = await createFederationState(key, 'https://evil.example', 1_800_000_000);

    await expect(validateFederationState(issued.cookieValue, issued.state, key)).resolves.toEqual({
      returnTo: null,
    });
  });

  it.each([
    '//evil.example',
    '/%2f%2fevil.example',
    '/%5cevil.example',
    '/api/auth/start',
    '/login',
  ])('rejects redirect bypass candidate %s', (returnTo) => {
    expect(safeLocalReturnPath(returnTo)).toBeNull();
  });
});
