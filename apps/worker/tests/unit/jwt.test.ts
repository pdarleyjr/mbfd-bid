import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from '../../src/lib/jwt';

const TEST_KEY = 'A'.repeat(64); // 32-byte hex placeholder

const payload = {
  sub: 555,
  emp: '20731',
  role: 'member' as const,
  rank: 'LT' as const,
  first_name: 'Peter',
  last_name: 'Darley',
  fresh_auth_at: Math.floor(Date.now() / 1000),
};

describe('signJwt / verifyJwt', () => {
  it('round-trips a valid JWT', async () => {
    const token = await signJwt(payload, TEST_KEY, '8h');
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const verified = await verifyJwt(token, TEST_KEY);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.emp).toBe(payload.emp);
    expect(verified.role).toBe('member');
  });

  it('rejects a token signed with a different key', async () => {
    const token = await signJwt(payload, TEST_KEY, '8h');
    await expect(verifyJwt(token, 'B'.repeat(64))).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signJwt(payload, TEST_KEY, '-1s');
    await expect(verifyJwt(token, TEST_KEY)).rejects.toThrow();
  });
});
