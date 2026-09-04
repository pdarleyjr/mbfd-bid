import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { signWebSocketTicket, verifyJwt } from '@/lib/jwt';
import { csrfFailureForUnsafeRequest } from '@/lib/server-csrf';
import { getWorkerBase } from '@/lib/worker-base';
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

  const refresh = await fetch(`${getWorkerBase()}/api/auth/revalidate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  const refreshed = (await refresh?.json().catch(() => null)) as { jwt?: unknown } | null;
  const currentJwt = refresh?.ok && typeof refreshed?.jwt === 'string' ? refreshed.jwt : null;
  if (currentJwt === null)
    return NextResponse.json({ error: 'session_revalidation_required' }, { status: 401 });
  const claims = await verifyJwt(currentJwt, signingKey).catch(() => null);
  if (claims === null) return NextResponse.json({ error: 'invalid_session' }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const localIdentity = await fetch(`${getWorkerBase()}/api/me`, {
    headers: { Authorization: `Bearer ${currentJwt}` },
  }).catch(() => null);
  const localIdentityBody = (await localIdentity?.json().catch(() => null)) as {
    memberId?: unknown;
  } | null;
  const localMemberId = localIdentityBody?.memberId;
  if (
    !localIdentity?.ok ||
    typeof localMemberId !== 'number' ||
    !Number.isSafeInteger(localMemberId) ||
    localMemberId <= 0
  )
    return NextResponse.json({ error: 'local_identity_required' }, { status: 401 });

  const ticket = await signWebSocketTicket(
    {
      sub: claims.sub,
      member_id: localMemberId,
      security_version: claims.security_version,
      role: claims.role,
      session_id: parsed.data.session_id,
    },
    signingKey,
  );
  const response = NextResponse.json({ ticket }, { headers: { 'cache-control': 'no-store' } });
  (await cookies()).set(JWT_COOKIE_NAME, currentJwt, JWT_COOKIE_OPTS);
  return response;
}
