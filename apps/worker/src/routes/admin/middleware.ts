import type { JwtPayload } from '@mbfd/shared';
import type { MiddlewareHandler } from 'hono';
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
