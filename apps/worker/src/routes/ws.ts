import { Hono } from 'hono';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import { isExpectedPublicWebOrigin } from '../lib/public-web-origin.js';
import type { WorkerEnv } from '../types/env.js';

const ws = new Hono<{ Bindings: WorkerEnv }>();

/**
 * WebSocket upgrade for the live bid session.
 *
 * Browsers cannot set the `Authorization` header on a WebSocket upgrade
 * (the API only exposes URL + subprotocols + cookies), so we accept the
 * JWT via:
 *   1. `?token=<jwt>` query param  (browser path — preferred)
 *   2. `Authorization: Bearer <jwt>` header  (server-side / curl)
 * Validation is identical in both cases; the query param value carries the
 * same short-lived JWT used everywhere else and is not logged at the edge.
 */
ws.get('/session/:id', async (c) => {
  const env = validateEnv(c.env);

  let token: string | null = null;
  const queryToken = c.req.query('token');
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    token = queryToken;
  } else {
    const auth = c.req.header('Authorization');
    if (auth?.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }
  if (!token) {
    return c.json({ error: 'missing_auth' }, 401);
  }

  let claims: Awaited<ReturnType<typeof verifyJwt>>;
  try {
    claims = await verifyJwt(token, env.JWT_SIGNING_KEY);
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  // CORS middleware does not enforce WebSocket upgrades. Browser clients
  // must therefore present the exact public origin for this environment.
  if (!isExpectedPublicWebOrigin(env, c.req.header('Origin'))) {
    return c.json({ error: 'websocket_origin_forbidden' }, 403);
  }

  if (c.req.header('Upgrade') !== 'websocket') {
    return c.text('Upgrade Required', 426);
  }

  const id = c.req.param('id');
  const doId = c.env.BID_SESSION.idFromName(id);
  const stub = c.env.BID_SESSION.get(doId);
  // Forward to DO with verified claims in custom header so the DO does not
  // need to re-validate. The DO trusts only requests via its binding namespace.
  const upstream = await stub.fetch(`${new URL(c.req.url).origin}/ws`, {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
      'X-MBFD-Member-Id': String(claims.sub),
      'X-MBFD-Role': claims.role,
    },
  });
  return upstream as unknown as Response;
});

export default ws;
