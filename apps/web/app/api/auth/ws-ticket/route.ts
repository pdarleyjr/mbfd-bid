import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { signWebSocketTicket, verifyJwt } from '@/lib/jwt';
import { csrfFailureForUnsafeRequest } from '@/lib/server-csrf';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const Body = z
  .object({
    session_id: z.string().trim().min(1).max(160),
  })
  .strict();

/**
 * Converts the HttpOnly access session into a short-lived, session-scoped
 * WebSocket protocol credential. The browser never receives the access JWT.
 */
export async function POST(request: Request) {
  const csrfFailure = await csrfFailureForUnsafeRequest(request, cfEnv('ENV'));
  if (csrfFailure !== null) {
    return NextResponse.json({ error: `csrf_${csrfFailure}_forbidden` }, { status: 403 });
  }

  const store = await cookies();
  const jwt = store.get(JWT_COOKIE_NAME)?.value;
  if (!jwt) return NextResponse.json({ error: 'missing_auth' }, { status: 401 });

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) return NextResponse.json({ error: 'misconfigured' }, { status: 500 });

  const claims = await verifyJwt(jwt, signingKey).catch(() => null);
  if (claims === null) return NextResponse.json({ error: 'invalid_session' }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const ticket = await signWebSocketTicket(
    {
      sub: claims.sub,
      role: claims.role,
      session_id: parsed.data.session_id,
    },
    signingKey,
  );
  return NextResponse.json({ ticket }, { headers: { 'cache-control': 'no-store' } });
}
