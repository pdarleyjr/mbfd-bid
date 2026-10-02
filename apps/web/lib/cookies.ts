import { BID_SESSION_MAX_AGE_SEC } from '@mbfd/shared';

export const PIN_COOKIE_NAME = 'mbfd_pin';
export const JWT_COOKIE_NAME = 'mbfd_bid_jwt';
export const CSRF_COOKIE_NAME = 'mbfd_bid_csrf';
export const FEDERATION_STATE_COOKIE_NAME = 'mbfd_bid_auth_state';

export const PIN_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: BID_SESSION_MAX_AGE_SEC,
};

export const JWT_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: BID_SESSION_MAX_AGE_SEC,
};

export const FEDERATION_STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/api/auth/callback',
  maxAge: 5 * 60,
};

/**
 * Double-submit CSRF nonce. It must remain client-readable so browser code
 * can echo it in X-MBFD-CSRF, but it is still first-party only and expires
 * with the authenticated session.
 */
export const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: BID_SESSION_MAX_AGE_SEC,
};
