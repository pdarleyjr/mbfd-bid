import { cfEnv } from '@/lib/cf-env';
import { CSRF_COOKIE_NAME, CSRF_COOKIE_OPTS, JWT_COOKIE_NAME } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { createCsrfToken, isCsrfToken, isSameOriginBrowserRequest } from '@/lib/server-csrf';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Issues the client-readable half of the double-submit CSRF boundary only
 * after a same-origin request verifies the HttpOnly bid session. This route
 * does not forward a Worker mutation and is the one bootstrap exception that
 * cannot itself require an existing X-MBFD-CSRF header.
 */
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request, cfEnv('ENV'))) {
    return NextResponse.json({ error: 'csrf_bootstrap_origin_forbidden' }, { status: 403 });
  }

  const store = await cookies();
  const jwt = store.get(JWT_COOKIE_NAME)?.value;
  if (!jwt) return NextResponse.json({ error: 'missing_auth' }, { status: 401 });

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  try {
    await verifyJwt(jwt, signingKey);
  } catch {
    return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
  }

  const existing = store.get(CSRF_COOKIE_NAME)?.value;
  const token = isCsrfToken(existing) ? existing : createCsrfToken();
  store.set(CSRF_COOKIE_NAME, token, CSRF_COOKIE_OPTS);
  return NextResponse.json({ token }, { headers: { 'cache-control': 'no-store' } });
}
