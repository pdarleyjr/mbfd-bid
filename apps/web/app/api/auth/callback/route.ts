import { bidCallbackUri } from '@/lib/bid-federation';
import { cfEnv } from '@/lib/cf-env';
import { FEDERATION_STATE_COOKIE_NAME, JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { validateFederationState } from '@/lib/federation-state';
import { verifyJwt } from '@/lib/jwt';
import { publicWebOrigin } from '@/lib/public-web-origin';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function GET(request: Request) {
  const env = cfEnv('ENV');
  const origin = publicWebOrigin(env);
  const callback = bidCallbackUri(env);
  if (!origin || !callback) return NextResponse.json({ error: 'misconfigured' }, { status: 503 });

  const url = new URL(request.url);
  const returnedState = url.searchParams.get('state');
  const store = await cookies();
  const stateCookie = store.get(FEDERATION_STATE_COOKIE_NAME)?.value ?? null;
  if (!validateFederationState(stateCookie, returnedState)) {
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }
  store.delete(FEDERATION_STATE_COOKIE_NAME);

  if (url.searchParams.get('error') === 'access_denied') {
    return NextResponse.redirect(`${origin}/login?error=access_denied`);
  }

  const code = url.searchParams.get('code');
  if (!code || !CODE_PATTERN.test(code)) {
    return NextResponse.json({ error: 'invalid_authorization_code' }, { status: 400 });
  }

  const exchange = await fetch(`${getWorkerBase()}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: callback }),
  }).catch(() => null);
  if (!exchange) return NextResponse.redirect(`${origin}/login?error=auth_unavailable`);

  const body = (await exchange.json().catch(() => null)) as {
    jwt?: unknown;
    role?: unknown;
    error?: unknown;
  } | null;
  if (!exchange.ok || typeof body?.jwt !== 'string') {
    const error = exchange.status === 401 ? 'invalid_code' : 'auth_unavailable';
    return NextResponse.redirect(`${origin}/login?error=${error}`);
  }

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  const claims = signingKey ? await verifyJwt(body.jwt, signingKey).catch(() => null) : null;
  if (!claims || (claims.role !== 'admin' && claims.role !== 'member')) {
    return NextResponse.redirect(`${origin}/login?error=auth_unavailable`);
  }

  store.set(JWT_COOKIE_NAME, body.jwt, JWT_COOKIE_OPTS);
  return NextResponse.redirect(`${origin}${claims.role === 'admin' ? '/admin' : '/lobby'}`);
}
