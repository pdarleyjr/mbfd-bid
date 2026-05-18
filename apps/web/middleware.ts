import { PIN_COOKIE_NAME } from '@/lib/cookies';
import { type NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/pin).*)'],
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The PIN form itself is public
  if (pathname === '/' || pathname.startsWith('/api/pin')) return NextResponse.next();

  const pin = req.cookies.get(PIN_COOKIE_NAME)?.value;
  if (pin !== 'ok') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
