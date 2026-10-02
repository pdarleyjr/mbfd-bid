import { cfEnv } from '@/lib/cf-env';
import {
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_OPTS,
  JWT_COOKIE_NAME,
  JWT_COOKIE_OPTS,
  PIN_COOKIE_NAME,
  PIN_COOKIE_OPTS,
} from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { operatorSessionKey } from '@/lib/operator-step-up';
import { isCsrfToken } from '@/lib/server-csrf';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/** Hub revalidation renews an existing, same-identity operator session.
 * This endpoint returns timing/identity only, never a browser access token. */
export async function GET() {
  const store = await cookies();
  const token = store.get(JWT_COOKIE_NAME)?.value;
  const key = cfEnv('JWT_SIGNING_KEY');
  const failure = (error: string, status: number) =>
    NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
  if (!token) return failure('missing_auth', 401);
  if (!key) return failure('misconfigured', 503);
  const original = await verifyJwt(token, key).catch(() => null);
  if (original?.role !== 'admin') return failure('invalid_session', 401);
  const refresh = await fetch(`${getWorkerBase()}/api/auth/revalidate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);
  if (!refresh?.ok)
    return failure('session_revalidation_required', refresh?.status === 401 ? 401 : 503);
  const body: unknown = await refresh.json().catch(() => null);
  const currentToken =
    body && typeof body === 'object' && 'jwt' in body && typeof body.jwt === 'string'
      ? body.jwt
      : null;
  const current = currentToken ? await verifyJwt(currentToken, key).catch(() => null) : null;
  if (
    !currentToken ||
    !current ||
    current.role !== 'admin' ||
    operatorSessionKey(current) !== operatorSessionKey(original)
  )
    return failure('invalid_session', 401);
  store.set(JWT_COOKIE_NAME, currentToken, JWT_COOKIE_OPTS);
  // Keep existing companion cookies aligned with the renewed session.
  // Do not recreate a missing PIN or rotate the console's cached CSRF nonce.
  const pin = store.get(PIN_COOKIE_NAME)?.value;
  if (pin === 'ok') store.set(PIN_COOKIE_NAME, pin, PIN_COOKIE_OPTS);
  const csrf = store.get(CSRF_COOKIE_NAME)?.value;
  if (isCsrfToken(csrf)) store.set(CSRF_COOKIE_NAME, csrf, CSRF_COOKIE_OPTS);
  return NextResponse.json(
    {
      operatorKey: operatorSessionKey(current),
      expiresAtSec: current.exp,
      serverNowSec: Math.floor(Date.now() / 1000),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
