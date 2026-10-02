/**
 * Maximum age of verified Hub authorization for a protected admin command.
 * Every admin write revalidates Hub before this gate. This is not a timer
 * requiring the operator to repeat interactive sign-in.
 */
export const STEP_UP_MAX_AGE_SEC = 300;

/**
 * Pure function — returns true when Hub authorization is within the step-up
 * window relative to `nowSec`. Boundary is exclusive: an auth that is
 * exactly STEP_UP_MAX_AGE_SEC seconds old is NOT fresh.
 *
 * Both parameters are unix seconds. A future claim is rejected rather than
 * extending the authorization window. Pass `Math.floor(Date.now() / 1000)`
 * for the production clock; tests can pass a fixed value.
 */
export function isStepUpFresh(authorizedAtSec: number, nowSec: number): boolean {
  return authorizedAtSec <= nowSec && nowSec - authorizedAtSec < STEP_UP_MAX_AGE_SEC;
}
