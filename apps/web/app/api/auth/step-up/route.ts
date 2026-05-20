import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { verifyJwt } from '@/lib/jwt';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'edge';

const Body = z.object({
  employee_id: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }

  const login = await fetch(`${getWorkerBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  }).catch(() => null);

  if (login === null) {
    return NextResponse.json({ error: 'worker_unavailable' }, { status: 503 });
  }

  const body = (await login.json().catch(() => ({}))) as {
    jwt?: string;
    role?: string;
    error?: string;
  };
  if (!login.ok || typeof body.jwt !== 'string') {
    return NextResponse.json(
      { error: body.error ?? 'invalid_credentials' },
      { status: login.status },
    );
  }

  const claims = await verifyJwt(body.jwt, signingKey).catch(() => null);
  if (!claims || claims.role !== 'admin') {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 });
  }

  const c = await cookies();
  c.set(JWT_COOKIE_NAME, body.jwt, JWT_COOKIE_OPTS);
  return new NextResponse(null, { status: 204 });
}
