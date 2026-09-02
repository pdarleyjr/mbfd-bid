import { bidCallbackUri, hubAuthorizationEndpoint } from '@/lib/bid-federation';
import { cfEnv } from '@/lib/cf-env';
import { FEDERATION_STATE_COOKIE_NAME, FEDERATION_STATE_COOKIE_OPTS } from '@/lib/cookies';
import { createFederationState } from '@/lib/federation-state';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request = new Request('https://bid.invalid/api/auth/start')) {
  const environment = cfEnv('ENV');
  const callback = bidCallbackUri(environment);
  const authorizationEndpoint = hubAuthorizationEndpoint(environment);
  if (!callback || !authorizationEndpoint) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 503 });
  }

  const signingKey = cfEnv('JWT_SIGNING_KEY');
  if (!signingKey) return NextResponse.json({ error: 'misconfigured' }, { status: 503 });
  const returnTo = new URL(request.url).searchParams.get('returnTo');
  const transaction = await createFederationState(signingKey, returnTo);
  const store = await cookies();
  store.set(FEDERATION_STATE_COOKIE_NAME, transaction.cookieValue, FEDERATION_STATE_COOKIE_OPTS);

  const authorize = new URL(authorizationEndpoint);
  authorize.searchParams.set('client_id', 'bid');
  authorize.searchParams.set('redirect_uri', callback);
  authorize.searchParams.set('state', transaction.state);

  return NextResponse.redirect(authorize);
}
