import { describe, expect, it } from 'vitest';
import { LoginRequestSchema, LoginResponseSchema } from '../../src/schemas/auth';

describe('LoginRequestSchema', () => {
  it('accepts a valid employee_id + password', () => {
    const parsed = LoginRequestSchema.safeParse({
      employee_id: '20731',
      password: 'correct-horse-battery-staple',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty employee_id', () => {
    const parsed = LoginRequestSchema.safeParse({
      employee_id: '',
      password: 'pw',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a password shorter than 6 chars', () => {
    const parsed = LoginRequestSchema.safeParse({
      employee_id: '20731',
      password: '12345',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('LoginResponseSchema', () => {
  it('parses a portal success response', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 555,
      employee_id: '20731',
      first_name: 'Peter',
      last_name: 'Darley',
      rank: 'LT',
      role: 'member',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown rank', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 555,
      employee_id: '20731',
      first_name: 'X',
      last_name: 'Y',
      rank: 'ENSIGN',
      role: 'member',
    });
    expect(parsed.success).toBe(false);
  });
});
