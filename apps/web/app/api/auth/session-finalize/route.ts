import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'edge';

const Body = z.object({ jwt: z.string().min(1) });

export async function POST(req: Request) {
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
