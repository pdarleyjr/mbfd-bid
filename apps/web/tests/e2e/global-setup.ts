import type { FullConfig } from '@playwright/test';
import { signJwt } from '../../lib/jwt';

export default async function globalSetup(_: FullConfig) {
  const signingKey = process.env.JWT_SIGNING_KEY;
  if (!signingKey) {
    console.warn('[e2e] no JWT_SIGNING_KEY — tests requiring real JWT will skip');
    return;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: Parameters<typeof signJwt>[0] = {
    sub: 555,
    hub_user_id: 555,
    member_id: 555,
    emp: '20731',
    role: 'member',
    security_version: 1,
    rank: 'LT',
    first_name: 'Peter',
    last_name: 'Darley',
    fresh_auth_at: nowSec,
    authz_checked_at: nowSec,
  };
  const jwt = await signJwt(payload, signingKey, '1h');
  process.env.E2E_JWT = jwt;
}
