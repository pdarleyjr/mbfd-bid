import { getRequestContext } from '@cloudflare/next-on-pages';
import { SignJWT, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';

export const runtime = 'edge';

function keyToUint8(key: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    const bytes = key.match(/.{1,2}/g) ?? [];
    return Uint8Array.from(bytes.map((b) => Number.parseInt(b, 16)));
  }
  return new TextEncoder().encode(key);
}

function fp(v: string | undefined): string {
  if (!v) return 'MISSING';
  return `len=${v.length} first8=${v.substring(0, 8)} last8=${v.substring(v.length - 8)}`;
}

export async function GET() {
  const { env } = getRequestContext();
  const ctxKey = (env as Record<string, string | undefined>).JWT_SIGNING_KEY;

  const result: Record<string, unknown> = {
    ctx_key_fp: fp(ctxKey),
    proc_key_fp: fp(process.env.JWT_SIGNING_KEY),
    keys_equal: ctxKey === process.env.JWT_SIGNING_KEY,
    key_format: ctxKey ? (/^[0-9a-fA-F]{64}$/.test(ctxKey) ? 'hex64' : 'other') : 'none',
  };

  if (ctxKey) {
    const k = keyToUint8(ctxKey);
    // Sign a test JWT with ctx key
    const testJwt = await new SignJWT({ test: 'pages-signed' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(k);
    result.pages_signed_jwt = testJwt;

    // Fetch a worker JWT and verify it with ctx key
    try {
      const loginRes = await fetch('https://api.staging.bid.mbfdhub.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: 'admin', password: 'Cityofmiamibeach!' }),
      });
      const loginBody = (await loginRes.json()) as { jwt?: string };
      result.worker_jwt = loginBody.jwt;
      if (loginBody.jwt) {
        try {
          const { payload } = await jwtVerify(loginBody.jwt, k, { algorithms: ['HS256'] });
          result.worker_jwt_verify = { ok: true, payload };
        } catch (e) {
          result.worker_jwt_verify = {
            ok: false,
            err: e instanceof Error ? e.message : String(e),
          };
        }
      }
    } catch (e) {
      result.worker_fetch_err = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(result);
}
