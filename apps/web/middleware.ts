import { type NextRequest, NextResponse } from 'next/server';

// Page-level guards (lib/require-pin.ts, lib/require-admin.ts) handle auth
// for /lobby, /admin/*, and /login. Middleware just passes through.
// Kept as a no-op stub because OpenNext 1.x's bundler emits a
// middleware-manifest.json regardless and may dynamic-require it.

export const config = {
  matcher: [],
};

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}
