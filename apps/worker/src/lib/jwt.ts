import type { JwtPayload } from '@mbfd/shared';
import { JwtPayloadSchema } from '@mbfd/shared';
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
  return JwtPayloadSchema.parse(payload);
}
