import { cfEnv } from '@/lib/cf-env';
import { verifyJwt } from '@/lib/jwt';
import { isExpectedPublicWebOrigin } from '@/lib/public-web-origin';
import { getWorkerBase } from '@/lib/worker-base';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const Body = z.object({
  password: z.string().min(1),
  pin: z.string().regex(/^\d{4,8}$/),
});

function isSameOriginBootstrapRequest(req: Request): boolean {
  const expectedOrigin = isExpectedPublicWebOrigin(cfEnv('ENV'), req.headers.get('origin'));
  const fetchSite = req.headers.get('sec-fetch-site');
  return expectedOrigin && (fetchSite === null || fetchSite === 'same-origin');
}

/**
 * The narrow recovery path for an intentionally absent staging member PIN.
 * It verifies staging-local admin credentials and immediately exchanges the
 * returned signed JWT for one canonical settings write. No browser admin JWT
 * is issued, so this does not weaken the ordinary admin PIN gate.
 */
export async function POST(req: Request) {
  if (cfEnv('ENV') !== 'staging' || !isSameOriginBootstrapRequest(req)) {
    return NextResponse.json({ error: 'bootstrap_forbidden' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) return NextResponse.json({ error: 'bootstrap_unavailable' }, { status: 503 });

  const loginHeaders = new Headers({ 'content-type': 'application/json' });
  const clientIp = req.headers.get('cf-connecting-ip');
  if (clientIp) loginHeaders.set('cf-connecting-ip', clientIp);
  const login = await fetch(`${getWorkerBase()}/api/auth/login`, {
    method: 'POST',
    headers: loginHeaders,
    body: JSON.stringify({ employee_id: 'admin', password: parsed.data.password }),
  }).catch(() => null);
  if (!login) return NextResponse.json({ error: 'bootstrap_unavailable' }, { status: 503 });
  if (!login.ok) {
    return NextResponse.json(
      { error: login.status === 401 ? 'admin_required' : 'bootstrap_unavailable' },
      { status: login.status === 401 ? 401 : 503 },
    );
  }

  const loginBody = (await login.json().catch(() => null)) as { jwt?: unknown } | null;
  if (typeof loginBody?.jwt !== 'string') {
    return NextResponse.json({ error: 'bootstrap_unavailable' }, { status: 503 });
  }

  const claims = await verifyJwt(loginBody.jwt, signingKey).catch(() => null);
  if (claims?.role !== 'admin' || claims.sub !== 0 || claims.emp !== 'admin') {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 });
  }

  const upstream = await fetch(`${getWorkerBase()}/api/admin/settings/bid-pin`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${loginBody.jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ pin: parsed.data.pin }),
  }).catch(() => null);

  if (!upstream?.ok) {
    return NextResponse.json({ error: 'bootstrap_unavailable' }, { status: 503 });
  }
  return new NextResponse(null, { status: 204 });
}
