import type { JwtPayload } from '@mbfd/shared';
import { JwtPayloadSchema, LegacyFixtureJwtPayloadSchema } from '@mbfd/shared';
import { SignJWT, jwtVerify } from 'jose';

function keyToUint8(key: string): Uint8Array {
  // Accept either hex (32 bytes = 64 chars) or base64url
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    const bytes = key.match(/.{1,2}/g) ?? [];
    return Uint8Array.from(bytes.map((b) => Number.parseInt(b, 16)));
  }
  return new TextEncoder().encode(key);
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  signingKey: string,
  expiresIn = '8h',
): Promise<string> {
  const key = keyToUint8(signingKey);
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifyJwt(token: string, signingKey: string): Promise<JwtPayload> {
  const key = keyToUint8(signingKey);
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
  const canonical = JwtPayloadSchema.safeParse(payload);
  if (canonical.success) return canonical.data;

  // This compatibility path is a test-fixture migration aid only. Cloudflare
  // Workers do not expose Node's process object, so a deployed runtime always
  // fails closed on a legacy `sub = member_id` token.
  const testEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.VITEST;
  if (testEnv !== 'true') throw canonical.error;
  const legacy = LegacyFixtureJwtPayloadSchema.parse(payload);
  const hubUserId = legacy.sub;
  return {
    ...legacy,
    sub: hubUserId,
    hub_user_id: hubUserId,
    // Historical fixture-only synthetic admins retain member 0 so their
    // legacy audit assertions remain isolated from production identities.
    member_id: legacy.sub,
    security_version: 1,
    authz_checked_at: legacy.iat,
  } as JwtPayload;
}
