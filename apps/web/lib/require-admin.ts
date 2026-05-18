import type { JwtPayload } from '@mbfd/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { JWT_COOKIE_NAME } from './cookies';
import { verifyJwt } from './jwt';

export async function requireAdmin(): Promise<JwtPayload> {
  const store = await cookies();
  const token = store.get(JWT_COOKIE_NAME)?.value;
  if (!token) redirect('/login');

  let claims: JwtPayload;
  try {
    const signingKey = process.env.JWT_SIGNING_KEY;
    if (!signingKey) throw new Error('missing JWT_SIGNING_KEY');
    claims = await verifyJwt(token, signingKey);
  } catch {
    redirect('/login');
  }

  if (claims.role !== 'admin') redirect('/lobby');
  return claims;
}
