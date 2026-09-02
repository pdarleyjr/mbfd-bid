import { describe, expect, it } from 'vitest';
import {
  ADMIN_AUTHZ_MAX_AGE_SEC,
  MEMBER_AUTHZ_MAX_AGE_SEC,
  isAuthorizationFresh,
} from '../../src/lib/federated-session.js';

describe('bounded Hub authorization freshness', () => {
  it('accepts admin authorization immediately before five minutes and rejects it at five minutes', () => {
    const now = 1_800_000_000;
    expect(
      isAuthorizationFresh(
        { role: 'admin', authz_checked_at: now - ADMIN_AUTHZ_MAX_AGE_SEC + 1 },
        now,
      ),
    ).toBe(true);
    expect(
      isAuthorizationFresh({ role: 'admin', authz_checked_at: now - ADMIN_AUTHZ_MAX_AGE_SEC }, now),
    ).toBe(false);
  });

  it('accepts member authorization immediately before fifteen minutes and rejects it at fifteen minutes', () => {
    const now = 1_800_000_000;
    expect(
      isAuthorizationFresh(
        { role: 'member', authz_checked_at: now - MEMBER_AUTHZ_MAX_AGE_SEC + 1 },
        now,
      ),
    ).toBe(true);
    expect(
      isAuthorizationFresh(
        { role: 'member', authz_checked_at: now - MEMBER_AUTHZ_MAX_AGE_SEC },
        now,
      ),
    ).toBe(false);
  });

  it('fails closed for a future authorization timestamp', () => {
    expect(isAuthorizationFresh({ role: 'member', authz_checked_at: 101 }, 100)).toBe(false);
  });
});
