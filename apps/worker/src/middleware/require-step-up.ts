import type { JwtPayload } from '@mbfd/shared';
import type { MiddlewareHandler } from 'hono';
import { isStepUpFresh } from '../lib/step-up-auth.js';
import type { WorkerEnv } from '../types/env.js';

type Env = {
  Bindings: WorkerEnv;
  Variables: { claims: JwtPayload };
};

/**
 * Returns a Hono middleware that 401s if the verified JWT claims (set by
 * requireAdmin) have a fresh_auth_at older than STEP_UP_MAX_AGE_SEC.
 *
 * MUST be composed AFTER requireAdmin — if claims are absent, returns 403.
 *
 * The clock injection is for tests; production passes nothing and the
 * middleware uses Date.now().
 */
export function requireStepUpAuth(
  clock: () => number = () => Math.floor(Date.now() / 1000),
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const claims = c.get('claims');
    if (claims === undefined) {
      return c.json({ error: 'admin_required' }, 403);
    }
    const nowSec = clock();
    if (!isStepUpFresh(claims.fresh_auth_at, nowSec)) {
      return c.json({ error: 'step_up_required', expired_at: claims.fresh_auth_at }, 401);
    }
    await next();
    return;
  };
}
