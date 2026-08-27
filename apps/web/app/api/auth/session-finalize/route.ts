import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { isExpectedPublicWebOrigin } from '@/lib/public-web-origin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const Body = z.object({ jwt: z.string().min(1) });

function isSameOriginSessionFinalizeRequest(request: Request): boolean {
  if (!isExpectedPublicWebOrigin(cfEnv('ENV'), request.headers.get('Origin'))) return false;

  // Fetch Metadata is defense in depth. Older clients may omit it, but any
  // supplied value other than exact same-origin is rejected before mutation.
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return fetchSite === null || fetchSite === 'same-origin';
}

export async function POST(req: Request) {
  if (!isSameOriginSessionFinalizeRequest(req)) {
    return NextResponse.json({ error: 'session_finalize_origin_forbidden' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const signingKey = cfEnv('JWT_SIGNING_KEY');
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
