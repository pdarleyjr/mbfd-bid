import type { FullConfig } from '@playwright/test';
import { SignJWT } from 'jose';

export default async function globalSetup(_: FullConfig) {
  const signingKey = process.env.JWT_SIGNING_KEY;
  if (!signingKey) {
    console.warn('[e2e] no JWT_SIGNING_KEY — tests requiring real JWT will skip');
    return;
  }
  const key = new TextEncoder().encode(signingKey);
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: 555,
    emp: '20731',
    role: 'member',
    rank: 'LT',
    first_name: 'Peter',
    last_name: 'Darley',
    fresh_auth_at: nowSec,
  };
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  process.env.E2E_JWT = jwt;
}
