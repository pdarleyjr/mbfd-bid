import { zValidator } from '@hono/zod-validator';
import type { LoginResponse } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { constantTimeEqual, getBidPin, isValidPin } from '../lib/bid-pin';
import { validateEnv } from '../lib/env';
import { refreshFederatedSession } from '../lib/federated-session';
import { signJwt, verifyJwt } from '../lib/jwt';
import { exchangeAuthorizationCode } from '../lib/portal-client';
import { publicWebOrigin } from '../lib/public-web-origin';
import { rateLimitByIp } from '../middleware/rate-limit';
import type { WorkerEnv } from '../types/env';

const auth = new Hono<{ Bindings: WorkerEnv }>();

const AuthorizationCodeExchangeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  redirect_uri: z.string().url(),
});

auth.post(
  '/exchange',
  zValidator('json', AuthorizationCodeExchangeSchema, (result, c) => {
    if (!result.success) return c.json({ error: 'invalid_body' }, 400);
    return undefined;
  }),
  async (c) => {
    const input = c.req.valid('json');
    const expectedOrigin = publicWebOrigin(c.env);
    const expectedCallback = expectedOrigin ? `${expectedOrigin}/api/auth/callback` : null;
    if (input.redirect_uri !== expectedCallback) {
      return c.json({ error: 'invalid_redirect_uri' }, 400);
    }

    const env = validateEnv(c.env);
    let portalResponse: LoginResponse | null;
    try {
      portalResponse = await exchangeAuthorizationCode({
        portalBaseUrl: env.PORTAL_BASE_URL,
        token: env.PORTAL_BID_FEDERATION_TOKEN,
        code: input.code,
        redirect_uri: input.redirect_uri,
      });
    } catch {
      console.info('[bid.auth]', {
        event: 'federation_exchange',
        result: 'failure',
        category: 'hub_unavailable',
        environment: c.env.ENV,
      });
      return c.json({ error: 'portal_unavailable' }, 503);
    }

    if (!portalResponse) {
      console.info('[bid.auth]', {
        event: 'federation_exchange',
        result: 'failure',
        category: 'invalid_authorization_code',
        environment: c.env.ENV,
      });
      return c.json({ error: 'invalid_authorization_code' }, 401);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(
      {
        sub: portalResponse.hub_user_id,
        hub_user_id: portalResponse.hub_user_id,
        member_id: portalResponse.member_id,
        emp: portalResponse.employee_id,
        role: portalResponse.role,
        security_version: portalResponse.security_version,
        rank: portalResponse.rank,
        first_name: portalResponse.first_name,
        last_name: portalResponse.last_name,
        fresh_auth_at: nowSec,
        authz_checked_at: nowSec,
      },
      env.JWT_SIGNING_KEY,
      '8h',
    );

    console.info('[bid.auth]', {
      event: 'federation_exchange',
      result: 'success',
      environment: c.env.ENV,
    });
    return c.json({
      jwt,
      role: portalResponse.role,
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

auth.post('/revalidate', async (c) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) return c.json({ error: 'missing_auth' }, 401);
  const env = validateEnv(c.env);
  const claims = await verifyJwt(authorization.slice(7), env.JWT_SIGNING_KEY).catch(() => null);
  if (claims === null) return c.json({ error: 'invalid_token' }, 401);
  const result = await refreshFederatedSession(claims, env, Math.floor(Date.now() / 1000), true);
  if (!result.ok) {
    console.info('[bid.auth]', {
      event: 'federation_revalidation',
      result: 'failure',
      category: result.category,
      environment: c.env.ENV,
    });
    return c.json({ error: result.category }, result.category === 'invalid_identity' ? 401 : 503);
  }
  console.info('[bid.auth]', {
    event: 'federation_revalidation',
    result: 'success',
    environment: c.env.ENV,
  });
  return c.json(
    { jwt: result.jwt, role: result.claims.role },
    { headers: { 'cache-control': 'no-store' } },
  );
});

const VerifyPinBody = z.object({ pin: z.string() });

/**
 * Verify the member bid-page PIN against the explicitly configured KV value.
 * Rate-limited per IP via the existing helper. Returns 204 on success — the
 * Next.js edge proxy sets the cookie. Never returns the PIN itself.
 */
auth.post('/verify-pin', async (c) => {
  if (!c.env.KV || typeof c.env.KV.get !== 'function' || typeof c.env.KV.put !== 'function') {
    return c.json({ error: 'rate_limit_unavailable' }, 503);
  }
  try {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const check = await rateLimitByIp(c.env.KV, `pin:${ip}`);
    if (!check.allowed) {
      c.header('Retry-After', String(check.retryAfterSec));
      return c.json({ error: 'rate_limited' }, 429);
    }
  } catch (err) {
    console.error('[auth.verify-pin] rate-limit check unavailable', err);
    return c.json({ error: 'rate_limit_unavailable' }, 503);
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
