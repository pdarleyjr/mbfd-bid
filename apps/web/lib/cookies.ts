export const PIN_COOKIE_NAME = 'mbfd_pin';
export const JWT_COOKIE_NAME = 'mbfd_bid_jwt';

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
