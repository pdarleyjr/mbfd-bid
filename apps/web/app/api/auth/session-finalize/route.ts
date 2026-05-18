import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Runtime: Node.js (default for App Router). OpenNext on Cloudflare Workers
// requires edge-runtime routes to live in a separate function; the default
// runtime bundles cleanly with the rest of the worker output.

const Body = z.object({ jwt: z.string().min(1) });

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const signingKey = process.env.JWT_SIGNING_KEY;
  if (!signingKey) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }

  try {
    await verifyJwt(parsed.data.jwt, signingKey);
  } catch {
    return NextResponse.json({ error: 'invalid_jwt' }, { status: 401 });
  }

  const c = await cookies();
  c.set(JWT_COOKIE_NAME, parsed.data.jwt, JWT_COOKIE_OPTS);
  return new NextResponse(null, { status: 204 });
}
