import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS, PIN_COOKIE_NAME, PIN_COOKIE_OPTS } from '@/lib/cookies';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Clears every first-party access cookie. The API JWT is the authenticated
 * session; the PIN gate is also cleared so a shared device returns to the
 * same unauthenticated entry point as a new browser context.
 */
export async function POST() {
  const store = await cookies();
  store.set(JWT_COOKIE_NAME, '', { ...JWT_COOKIE_OPTS, maxAge: 0 });
  store.set(PIN_COOKIE_NAME, '', { ...PIN_COOKIE_OPTS, maxAge: 0 });
  return new NextResponse(null, { status: 204 });
}
