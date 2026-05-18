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

describe('LoginRequestSchema — edge cases', () => {
  it('rejects whitespace-only employee_id (trim then min)', () => {
    const parsed = LoginRequestSchema.safeParse({
      employee_id: '   ',
      password: 'long-enough-pw',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('LoginResponseSchema — edge cases', () => {
  it('rejects member_id = 0', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 0,
      employee_id: '20731',
      first_name: 'Peter',
      last_name: 'Darley',
      rank: 'LT',
      role: 'member',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects member_id = -1', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: -1,
      employee_id: '20731',
      first_name: 'Peter',
      last_name: 'Darley',
      rank: 'LT',
      role: 'member',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects fractional member_id (3.14)', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 3.14,
      employee_id: '20731',
      first_name: 'Peter',
      last_name: 'Darley',
      rank: 'LT',
      role: 'member',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty first_name', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 555,
      employee_id: '20731',
      first_name: '',
      last_name: 'Darley',
      rank: 'LT',
      role: 'member',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects role outside member|admin', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 555,
      employee_id: '20731',
      first_name: 'Peter',
      last_name: 'Darley',
      rank: 'LT',
      role: 'superuser',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing required field (rank)', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 555,
      employee_id: '20731',
      first_name: 'Peter',
      last_name: 'Darley',
      role: 'member',
    });
    expect(parsed.success).toBe(false);
  });

  it('PRESERVES unknown keys (passthrough)', () => {
    const parsed = LoginResponseSchema.safeParse({
      member_id: 555,
      employee_id: '20731',
      first_name: 'Peter',
      last_name: 'Darley',
      rank: 'LT',
      role: 'member',
      future_field: 'tomorrow',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).future_field).toBe('tomorrow');
    }
  });
});
