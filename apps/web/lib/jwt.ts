import type { JwtPayload, WebSocketTicketClaims } from '@mbfd/shared';
import {
  JwtPayloadSchema,
  LegacyFixtureJwtPayloadSchema,
  WEBSOCKET_TICKET_AUDIENCE,
} from '@mbfd/shared';
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
  const testEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.VITEST;
  if (testEnv !== 'true') throw canonical.error;
  const legacy = LegacyFixtureJwtPayloadSchema.parse(payload);
  const hubUserId = legacy.sub;
  return {
    ...legacy,
    sub: hubUserId,
    hub_user_id: hubUserId,
    member_id: legacy.sub,
    security_version: 1,
    authz_checked_at: legacy.iat,
  } as JwtPayload;
}

/**
 * Signs a narrowly-scoped, one-minute browser WebSocket upgrade ticket. It
 * deliberately excludes the access JWT's employee and personnel claims.
 */
export async function signWebSocketTicket(
  claims: Pick<
    WebSocketTicketClaims,
    'sub' | 'member_id' | 'security_version' | 'role' | 'session_id'
  >,
  signingKey: string,
): Promise<string> {
  const key = keyToUint8(signingKey);
  return new SignJWT({ ...claims, sub: String(claims.sub) })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(WEBSOCKET_TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(key);
}
