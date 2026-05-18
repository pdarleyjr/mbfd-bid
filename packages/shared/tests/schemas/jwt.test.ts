import { describe, expect, it } from 'vitest';
import { JwtPayloadSchema } from '../../src/schemas/jwt.js';

const validPayload = {
  sub: 555,
  emp: '20731',
  role: 'member' as const,
  rank: 'LT' as const,
  first_name: 'Peter',
  last_name: 'Darley',
  fresh_auth_at: 1_700_000_000,
  iat: 1_700_000_000,
  exp: 1_700_028_800,
};

describe('JwtPayloadSchema', () => {
  it('parses a complete valid payload', () => {
    expect(JwtPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects missing iat (required for verified payloads)', () => {
    const { iat: _iat, ...rest } = validPayload;
    expect(JwtPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing exp (required for verified payloads)', () => {
    const { exp: _exp, ...rest } = validPayload;
    expect(JwtPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects sub = 0', () => {
    expect(JwtPayloadSchema.safeParse({ ...validPayload, sub: 0 }).success).toBe(false);
  });

  it('rejects unknown rank', () => {
    expect(JwtPayloadSchema.safeParse({ ...validPayload, rank: 'ENSIGN' }).success).toBe(false);
  });

  it('preserves additional jose claims via passthrough (iss, aud)', () => {
    const result = JwtPayloadSchema.safeParse({
      ...validPayload,
      iss: 'mbfd-bid-worker',
      aud: 'mbfd-bid-web',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).iss).toBe('mbfd-bid-worker');
    }
  });
});
