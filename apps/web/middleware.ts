import { JWT_COOKIE_NAME, PIN_COOKIE_NAME } from '@/lib/cookies';
import { type NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/pin).*)'],
};

const PUBLIC_PATHS = new Set(['/', '/login']);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow PIN form + login page + their API routes
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith('/api/pin') ||
    pathname.startsWith('/api/auth/session-finalize')
  ) {
    // …but still require PIN before /login
    if (pathname === '/login' && req.cookies.get(PIN_COOKIE_NAME)?.value !== 'ok') {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // All other paths require both PIN and JWT
  if (req.cookies.get(PIN_COOKIE_NAME)?.value !== 'ok') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  if (!req.cookies.get(JWT_COOKIE_NAME)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
