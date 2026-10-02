/** A normal Hub-verified Bid session may remain idle for up to 30 days.
 * Successful Hub revalidation renews this bounded lifetime; it never bypasses
 * role, linked identity, revocation, or security-version checks. */
export const BID_SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
export const BID_SESSION_EXPIRES_IN = '30d';

/** Renewal is read-only and only runs while an operator is visibly active. */
export const OPERATOR_SESSION_RENEW_INTERVAL_SEC = 4 * 60;
export const OPERATOR_SESSION_ACTIVITY_WINDOW_SEC = 15 * 60;
