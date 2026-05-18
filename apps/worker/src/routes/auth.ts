import { zValidator } from '@hono/zod-validator';
import { LoginRequestSchema, type LoginResponse } from '@mbfd/shared';
import { Hono } from 'hono';
import { isAdminEmployeeId, validateEnv } from '../lib/env';
import { signJwt } from '../lib/jwt';
import { verifyCredentials } from '../lib/portal-client';
import type { WorkerEnv } from '../types/env';

const auth = new Hono<{ Bindings: WorkerEnv }>();

auth.post('/login', zValidator('json', LoginRequestSchema), async (c) => {
  const { employee_id, password } = c.req.valid('json');
  const env = validateEnv(c.env);

  let portalResponse: LoginResponse | null;
  try {
    portalResponse = await verifyCredentials({
      portalBaseUrl: env.PORTAL_BASE_URL,
      token: env.PORTAL_BID_READER,
      employee_id,
      password,
    });
  } catch (err) {
    console.error('[auth.login] portal error', err);
    return c.json({ error: 'portal_unavailable' }, 503);
  }

  if (!portalResponse) {
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // Plan 02 Task 20 — promote employee_id to admin via ADMIN_EMPLOYEE_IDS allow-list.
  // The portal does not yet expose an is_admin flag; this is rehearsal scaffolding
  // that Plan 05 (admin console) will replace with portal-sourced roles.
  const effectiveRole = isAdminEmployeeId(env.ADMIN_EMPLOYEE_IDS, portalResponse.employee_id)
    ? 'admin'
    : portalResponse.role;
  const jwt = await signJwt(
    {
      sub: portalResponse.member_id,
      emp: portalResponse.employee_id,
      role: effectiveRole,
      rank: portalResponse.rank,
      first_name: portalResponse.first_name,
      last_name: portalResponse.last_name,
      fresh_auth_at: nowSec,
    },
    env.JWT_SIGNING_KEY,
    '8h',
  );

  return c.json({
    jwt,
    role: effectiveRole,
    member: {
      member_id: portalResponse.member_id,
      employee_id: portalResponse.employee_id,
      first_name: portalResponse.first_name,
      last_name: portalResponse.last_name,
      rank: portalResponse.rank,
    },
  });
});

export default auth;
