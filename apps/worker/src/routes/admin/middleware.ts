import { type JwtPayload, type LiveBidAction, isLiveBidActionAuthorized } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getDb } from '../../db/index.js';
import { bidSessions } from '../../db/schema.js';
import { loadBidSessionPolicySnapshot } from '../../lib/bid-policy.js';
import { verifyJwt } from '../../lib/jwt.js';
import type { WorkerEnv } from '../../types/env.js';

type AdminEnv = {
  Bindings: WorkerEnv;
  Variables: { claims: JwtPayload };
};

export const requireAdmin: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ error: 'missing_auth' }, 401);
  }

  const token = auth.slice(7).trim();
  if (!token) {
    return c.json({ error: 'missing_auth' }, 401);
  }

  let claims: JwtPayload;
  try {
    claims = await verifyJwt(token, c.env.JWT_SIGNING_KEY);
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  if (claims.role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403);
  }

  c.set('claims', claims);
  await next();
  return;
};

/**
 * Gate an operational live command after ordinary Hub-admin authentication.
 * The gate deliberately accepts mock sessions so rehearsal controls preserve
 * their existing behavior. A real session, however, needs a frozen V3 annual
 * policy and an explicit actor grant for each action.
 */
export function requireLiveBidAction(action: LiveBidAction): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const sessionId = c.req.param('id');
    if (!sessionId) return c.json({ error: 'bid_session_id_required' }, 400);
    try {
      const db = getDb(c.env.DB);
      const session = await db
        .select({ isMock: bidSessions.isMock })
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      // Let the owning route return its established 404 response.
      if (session === undefined || session.isMock) return next();
      const loaded = await loadBidSessionPolicySnapshot(db, sessionId);
      if (loaded.snapshot === null || loaded.snapshot.v !== 3 || loaded.snapshot.settings.v !== 3) {
        return c.json({ error: 'live_action_policy_missing', action }, 409);
      }
      const actorMemberId = c.get('claims').sub > 0 ? c.get('claims').sub : null;
      if (!isLiveBidActionAuthorized(loaded.snapshot.settings.livePolicy, action, actorMemberId)) {
        return c.json({ error: 'live_action_forbidden', action }, 403);
      }
    } catch {
      return c.json({ error: 'live_action_policy_unavailable', action }, 503);
    }
    await next();
  };
}
