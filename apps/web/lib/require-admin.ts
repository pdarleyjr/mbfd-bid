import type { JwtPayload } from '@mbfd/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cfEnv } from './cf-env';
import { JWT_COOKIE_NAME } from './cookies';
import { verifyJwt } from './jwt';
import { requirePin } from './require-pin';

export async function requireAdmin(): Promise<JwtPayload> {
  await requirePin();
  const store = await cookies();
  const token = store.get(JWT_COOKIE_NAME)?.value;
  if (!token) redirect('/login');

  let claims: JwtPayload;
  try {
    const signingKey = cfEnv('JWT_SIGNING_KEY');
    if (!signingKey) throw new Error('missing JWT_SIGNING_KEY');
    claims = await verifyJwt(token, signingKey);
  } catch {
    redirect('/login');
  }

  if (claims.role !== 'admin') redirect('/lobby');
  return claims;
}
