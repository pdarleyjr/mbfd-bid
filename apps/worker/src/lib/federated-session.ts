import type { JwtPayload } from '@mbfd/shared';
import type { ValidatedEnv } from './env.js';
import { signJwt } from './jwt.js';
import { revalidateFederatedIdentity } from './portal-client.js';

export const ADMIN_AUTHZ_MAX_AGE_SEC = 5 * 60;
export const MEMBER_AUTHZ_MAX_AGE_SEC = 15 * 60;

export function authorizationMaxAgeSec(role: JwtPayload['role']): number {
  return role === 'admin' ? ADMIN_AUTHZ_MAX_AGE_SEC : MEMBER_AUTHZ_MAX_AGE_SEC;
}

export function isAuthorizationFresh(
  claims: Pick<JwtPayload, 'role' | 'authz_checked_at'>,
  nowSec: number,
): boolean {
  const age = nowSec - claims.authz_checked_at;
  return age >= 0 && age < authorizationMaxAgeSec(claims.role);
}

export type FederationRefreshResult =
  | { ok: true; claims: JwtPayload; jwt: string | null }
  | { ok: false; category: 'invalid_identity' | 'authorization_unavailable' };

/**
 * Revalidates only after the bounded authorization window.  The Hub binds
 * user, member and security version in its request contract, so an invalid
 * link or changed security version fails closed rather than becoming a local
 * authorization decision.
 */
export async function refreshFederatedSession(
  claims: JwtPayload,
  env: ValidatedEnv,
  nowSec = Math.floor(Date.now() / 1000),
  force = false,
): Promise<FederationRefreshResult> {
  if (!force && isAuthorizationFresh(claims, nowSec)) return { ok: true, claims, jwt: null };
  try {
    const current = await revalidateFederatedIdentity({
      portalBaseUrl: env.PORTAL_BASE_URL,
      token: env.PORTAL_BID_FEDERATION_TOKEN,
      hub_user_id: claims.hub_user_id,
      security_version: claims.security_version,
      member_id: claims.member_id,
    });
    if (
      current === null ||
      current.hub_user_id !== claims.hub_user_id ||
      current.member_id !== claims.member_id ||
      current.security_version !== claims.security_version ||
      current.employee_id !== claims.emp
    ) {
      return { ok: false, category: 'invalid_identity' };
    }
    const next = {
      sub: claims.hub_user_id,
      hub_user_id: claims.hub_user_id,
      member_id: claims.member_id,
      emp: claims.emp,
      role: current.role,
      security_version: claims.security_version,
      rank: claims.rank,
      first_name: claims.first_name,
      last_name: claims.last_name,
      fresh_auth_at: claims.fresh_auth_at,
      authz_checked_at: nowSec,
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60,
    } satisfies JwtPayload;
    const jwt = await signJwt(
      {
        sub: next.sub,
        hub_user_id: next.hub_user_id,
        member_id: next.member_id,
        emp: next.emp,
        role: next.role,
        security_version: next.security_version,
        rank: next.rank,
        first_name: next.first_name,
        last_name: next.last_name,
        fresh_auth_at: next.fresh_auth_at,
        authz_checked_at: next.authz_checked_at,
      },
      env.JWT_SIGNING_KEY,
      '8h',
    );
    return { ok: true, claims: next, jwt };
  } catch {
    return { ok: false, category: 'authorization_unavailable' };
  }
}
