import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { LOCAL_ADMIN_USERNAME, verifyLocalAdminPassword } from '../../src/lib/env';

describe('LOCAL_ADMIN_USERNAME', () => {
  it('is the literal string "admin"', () => {
    expect(LOCAL_ADMIN_USERNAME).toBe('admin');
  });
});

describe('verifyLocalAdminPassword', () => {
  const fixturePassword = 'test-only-admin-password';
  const hash = bcrypt.hashSync(fixturePassword, 10);

  it('returns true for the correct password', () => {
    expect(verifyLocalAdminPassword(hash, fixturePassword)).toBe(true);
  });

  it('returns false for the wrong password', () => {
    expect(verifyLocalAdminPassword(hash, 'wrong-password')).toBe(false);
  });

  it('returns false when the hash secret is empty', () => {
    expect(verifyLocalAdminPassword('', fixturePassword)).toBe(false);
  });

  it('returns false when the candidate password is empty', () => {
    expect(verifyLocalAdminPassword(hash, '')).toBe(false);
  });

  it('returns false on a malformed hash without throwing', () => {
    expect(verifyLocalAdminPassword('not-a-valid-bcrypt-hash', fixturePassword)).toBe(false);
  });

  it('is case sensitive', () => {
    expect(verifyLocalAdminPassword(hash, fixturePassword.toUpperCase())).toBe(false);
    expect(verifyLocalAdminPassword(hash, fixturePassword.replace('admin', 'Admin'))).toBe(false);
  });

  it('rejects passwords missing the trailing punctuation', () => {
    expect(verifyLocalAdminPassword(hash, fixturePassword.slice(0, -1))).toBe(false);
  });
});
