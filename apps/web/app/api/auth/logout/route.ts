import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS, PIN_COOKIE_NAME, PIN_COOKIE_OPTS } from '@/lib/cookies';
import { isExpectedPublicWebOrigin } from '@/lib/public-web-origin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Clears every first-party access cookie. The API JWT is the authenticated
 * session; the PIN gate is also cleared so a shared device returns to the
 * same unauthenticated entry point as a new browser context.
 */
function isSameOriginLogoutRequest(request: Request): boolean {
  if (!isExpectedPublicWebOrigin(cfEnv('ENV'), request.headers.get('Origin'))) return false;

  // Fetch Metadata is defense in depth. Older clients may omit it, but any
  // supplied value other than exact same-origin is rejected before mutation.
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return fetchSite === null || fetchSite === 'same-origin';
}

export async function POST(request: Request) {
  if (!isSameOriginLogoutRequest(request)) {
    return NextResponse.json({ error: 'logout_origin_forbidden' }, { status: 403 });
  }

  const store = await cookies();
  store.set(JWT_COOKIE_NAME, '', { ...JWT_COOKIE_OPTS, maxAge: 0 });
  store.set(PIN_COOKIE_NAME, '', { ...PIN_COOKIE_OPTS, maxAge: 0 });
  return new NextResponse(null, { status: 204 });
}
