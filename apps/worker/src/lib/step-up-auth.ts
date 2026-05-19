/**
 * Maximum age (in seconds) of the JWT's fresh_auth_at claim for it to be
 * considered "stepped up" for an admin write. 300s = 5 minutes per spec §8.4.
 * Hard-coded — chiefs need consistent behavior across environments.
 */
export const STEP_UP_MAX_AGE_SEC = 300;

/**
 * Pure function — returns true when fresh_auth_at is within the step-up
 * window relative to `nowSec`. Boundary is exclusive: an auth that is
 * exactly STEP_UP_MAX_AGE_SEC seconds old is NOT fresh.
 *
 * Both parameters are unix seconds. Pass `Math.floor(Date.now() / 1000)`
 * for the production clock; tests can pass a fixed value.
 */
export function isStepUpFresh(freshAuthAtSec: number, nowSec: number): boolean {
  return nowSec - freshAuthAtSec < STEP_UP_MAX_AGE_SEC;
}
