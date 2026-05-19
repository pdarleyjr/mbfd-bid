import { Hono } from 'hono';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import type { WorkerEnv } from '../types/env.js';

const ws = new Hono<{ Bindings: WorkerEnv }>();

ws.get('/session/:id', async (c) => {
  const env = validateEnv(c.env);
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'missing_auth' }, 401);
  }
  let claims: Awaited<ReturnType<typeof verifyJwt>>;
  try {
    claims = await verifyJwt(auth.slice(7), env.JWT_SIGNING_KEY);
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
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
