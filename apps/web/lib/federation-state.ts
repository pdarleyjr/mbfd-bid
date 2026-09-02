import { SignJWT, jwtVerify } from 'jose';

export const FEDERATION_STATE_TTL_SEC = 5 * 60;

function keyFor(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function safeLocalReturnPath(value: string | null): string | null {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /%2f|%5c/i.test(value)
  )
    return null;
  try {
    const parsed = new URL(value, 'https://bid.invalid');
    if (parsed.origin !== 'https://bid.invalid' || !parsed.pathname.startsWith('/')) return null;
    if (parsed.pathname.startsWith('/api/auth/') || parsed.pathname === '/login') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export async function createFederationState(
  signingKey: string,
  returnTo: string | null,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ state: string; cookieValue: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const cookieValue = await new SignJWT({ state, return_to: safeLocalReturnPath(returnTo) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + FEDERATION_STATE_TTL_SEC)
    .sign(keyFor(signingKey));
  return { state, cookieValue };
}

export async function validateFederationState(
  cookieValue: string | null,
  returnedState: string | null,
  signingKey: string,
): Promise<{ returnTo: string | null } | null> {
  if (!cookieValue || !returnedState) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, keyFor(signingKey), { algorithms: ['HS256'] });
    if (typeof payload.state !== 'string' || payload.state.length !== returnedState.length)
      return null;
    let difference = 0;
    for (let index = 0; index < payload.state.length; index += 1) {
      difference |= payload.state.charCodeAt(index) ^ returnedState.charCodeAt(index);
    }
    return difference === 0
      ? {
          returnTo: safeLocalReturnPath(
            typeof payload.return_to === 'string' ? payload.return_to : null,
          ),
        }
      : null;
  } catch {
    return null;
  }
}
