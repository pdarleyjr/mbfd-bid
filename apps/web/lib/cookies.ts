export const PIN_COOKIE_NAME = 'mbfd_pin';
export const JWT_COOKIE_NAME = 'mbfd_bid_jwt';
export const CSRF_COOKIE_NAME = 'mbfd_bid_csrf';

export const PIN_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days — survives a multi-day bid event
};

export const JWT_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 60 * 60 * 8, // 8 hours
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
  maxAge: 60 * 60 * 8,
};
