import { zValidator } from '@hono/zod-validator';
import { LoginRequestSchema, type LoginResponse } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { constantTimeEqual, getBidPin, isValidPin } from '../lib/bid-pin';
import { LOCAL_ADMIN_USERNAME, validateEnv, verifyLocalAdminPassword } from '../lib/env';
import { signJwt } from '../lib/jwt';
import { verifyCredentials } from '../lib/portal-client';
import { rateLimitByEmployeeId, rateLimitByIp } from '../middleware/rate-limit';
import type { WorkerEnv } from '../types/env';

const auth = new Hono<{ Bindings: WorkerEnv }>();

// Synthetic identity for the shared admin account. `sub: 0` is reserved
// because real `members.id` starts at 1 (autoincrement). The audit log
// records `actor_id: 0` so admin actions are distinguishable from member
// activity even though there is no row in the members table.
const ADMIN_IDENTITY = {
  member_id: 0,
  employee_id: LOCAL_ADMIN_USERNAME,
  first_name: 'Bid',
  last_name: 'Admin',
  rank: 'CHIEF' as const,
} satisfies Omit<LoginResponse, 'role'>;

/**
 * Temporary staging-only bridge correction, authorized for the operator
 * rehearsal. The Hub credential bridge currently authenticates these
 * employees but reports every successful login as `member`; production must
 * continue to rely solely on a bridge-provided entitlement until Hub's
 * role-aware bridge is delivered.
 */
const STAGING_OPERATOR_ADMIN_EMPLOYEE_IDS = new Set(['20731', '19545']);

function resolvePortalRole(
  env: Pick<WorkerEnv, 'ENV'>,
  portalResponse: Pick<LoginResponse, 'employee_id' | 'role'>,
): LoginResponse['role'] {
  if (
    env.ENV === 'staging' &&
    portalResponse.role === 'member' &&
    STAGING_OPERATOR_ADMIN_EMPLOYEE_IDS.has(portalResponse.employee_id)
  ) {
    return 'admin';
  }
  return portalResponse.role;
}

auth.post(
  '/login',
  zValidator('json', LoginRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400);
    }
    return undefined;
  }),
  async (c) => {
    const { employee_id, password } = c.req.valid('json');
    const env = validateEnv(c.env);
    const nowSec = Math.floor(Date.now() / 1000);

    // Plan 09 Task 3 — rate limit by IP, then by employee_id. Fails open if KV
    // is unavailable: the goal is to throttle abuse, not take login down.
    if (c.env.KV && typeof c.env.KV.get === 'function') {
      try {
        const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
        const ipCheck = await rateLimitByIp(c.env.KV, ip);
        if (!ipCheck.allowed) {
          c.header('Retry-After', String(ipCheck.retryAfterSec));
          return c.json({ error: 'rate_limited', scope: 'ip' }, 429);
        }
        const empCheck = await rateLimitByEmployeeId(c.env.KV, employee_id);
        if (!empCheck.allowed) {
          c.header('Retry-After', String(empCheck.retryAfterSec));
          return c.json({ error: 'rate_limited', scope: 'employee_id' }, 429);
        }
      } catch (err) {
        console.error('[auth.login] rate-limit check failed (fail-open)', err);
      }
    }

    // Local admin login: employee_id="admin", password verified against the
    // LOCAL_ADMIN_PASSWORD_HASH bcrypt secret. Bypasses portal entirely.
    // Plan 02 rehearsal scaffolding; Plan 05 admin console replaces this.
    if (env.ENV === 'staging' && employee_id === LOCAL_ADMIN_USERNAME) {
      if (!verifyLocalAdminPassword(env.LOCAL_ADMIN_PASSWORD_HASH, password)) {
        return c.json({ error: 'invalid_credentials' }, 401);
      }
      const adminJwt = await signJwt(
        {
          sub: ADMIN_IDENTITY.member_id,
          emp: ADMIN_IDENTITY.employee_id,
          role: 'admin',
          rank: ADMIN_IDENTITY.rank,
          first_name: ADMIN_IDENTITY.first_name,
          last_name: ADMIN_IDENTITY.last_name,
          fresh_auth_at: nowSec,
        },
        env.JWT_SIGNING_KEY,
        '8h',
      );
      return c.json({
        jwt: adminJwt,
        role: 'admin' as const,
        member: { ...ADMIN_IDENTITY },
      });
    }

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

    const role = resolvePortalRole(env, portalResponse);

    const jwt = await signJwt(
      {
        sub: portalResponse.member_id,
        emp: portalResponse.employee_id,
        role,
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
      role,
      member: {
        member_id: portalResponse.member_id,
        employee_id: portalResponse.employee_id,
        first_name: portalResponse.first_name,
        last_name: portalResponse.last_name,
        rank: portalResponse.rank,
      },
    });
  },
);

const VerifyPinBody = z.object({ pin: z.string() });

/**
 * Verify the member bid-page PIN against the explicitly configured KV value.
 * Rate-limited per IP via the existing helper. Returns 204 on success — the
 * Next.js edge proxy sets the cookie. Never returns the PIN itself.
 */
auth.post('/verify-pin', async (c) => {
  // Rate limit. Fail-open on KV error so a transient hiccup doesn't lock
  // members out of the bid page.
  if (c.env.KV && typeof c.env.KV.get === 'function') {
    try {
      const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
      const check = await rateLimitByIp(c.env.KV, `pin:${ip}`);
      if (!check.allowed) {
        c.header('Retry-After', String(check.retryAfterSec));
        return c.json({ error: 'rate_limited' }, 429);
      }
    } catch (err) {
      console.error('[auth.verify-pin] rate-limit check failed (fail-open)', err);
    }
  }

  const json = await c.req.json().catch(() => null);
  const parsed = VerifyPinBody.safeParse(json);
  if (!parsed.success || !isValidPin(parsed.data.pin)) {
    return c.json({ error: 'invalid' }, 400);
  }

  const pinState = await getBidPin(c.env.KV);
  if (pinState.kind !== 'configured') {
    return c.json({ error: 'PIN_NOT_CONFIGURED' }, 503);
  }
  if (!constantTimeEqual(parsed.data.pin, pinState.setting.pin)) {
    return c.json({ error: 'invalid_pin' }, 401);
  }
  return c.body(null, 204);
});

export default auth;
