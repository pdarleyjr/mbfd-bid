import { publicWebOrigin } from './public-web-origin';

/**
 * The authoritative Hub authorization endpoint for each isolated Bid
 * environment. Keep this mapping explicit: staging must never redirect a
 * user into the live Hub, and an unknown environment must fail closed.
 */
export function hubAuthorizationEndpoint(env: string | undefined): string | null {
  if (env === 'staging') return 'https://staging.mbfdhub.com/auth/bid/authorize';
  if (env === 'production') return 'https://www.mbfdhub.com/auth/bid/authorize';
  return null;
}

export function bidCallbackUri(env: string | undefined): string | null {
  const origin = publicWebOrigin(env);
  return origin ? `${origin}/api/auth/callback` : null;
}
