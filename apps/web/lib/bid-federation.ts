import { publicWebOrigin } from './public-web-origin';

export const HUB_AUTHORIZATION_ENDPOINT = 'https://www.mbfdhub.com/auth/bid/authorize';

export function bidCallbackUri(env: string | undefined): string | null {
  const origin = publicWebOrigin(env);
  return origin ? `${origin}/api/auth/callback` : null;
}
