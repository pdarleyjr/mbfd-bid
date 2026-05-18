import { PIN_COOKIE_NAME, PIN_COOKIE_OPTS } from '@/lib/cookies';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Runtime: Node.js (default). OpenNext on Cloudflare requires edge-runtime
// routes to live in a separate function bundle; the default runtime bundles
// cleanly with the rest of the worker output.

const Body = z.object({ pin: z.string().min(4).max(8) });

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // PIN_HASH env is a bcrypt hash; we use timing-safe compare on hashed pin instead.
  // For v1 we accept the plain PIN against a CF env var (PIN_PLAIN).
  // In production, swap to bcrypt verify via `bcryptjs` or `@noble/hashes`.
  const expected = process.env.PIN_PLAIN ?? '2300';
  const ok = parsed.data.pin === expected;
  if (!ok) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 401 });
  }

  const c = await cookies();
  c.set(PIN_COOKIE_NAME, 'ok', PIN_COOKIE_OPTS);
  return new NextResponse(null, { status: 204 });
}
