import { getRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';

export const runtime = 'edge';

function fingerprint(v: string | undefined): string {
  if (!v) return 'MISSING';
  return `len=${v.length} first4=${v.substring(0, 4)} last4=${v.substring(v.length - 4)}`;
}

export async function GET() {
  let ctxEnvKeys: string[] = [];
  let ctxJwt = 'NO_CTX';
  let ctxWorker = 'NO_CTX';
  try {
    const { env } = getRequestContext();
    ctxEnvKeys = Object.keys(env as Record<string, unknown>);
    ctxJwt = fingerprint((env as Record<string, string | undefined>).JWT_SIGNING_KEY);
    ctxWorker = fingerprint((env as Record<string, string | undefined>).WORKER_URL);
  } catch (e) {
    ctxJwt = `THREW: ${e instanceof Error ? e.message : String(e)}`;
  }
  return NextResponse.json({
    process_env_jwt: fingerprint(process.env.JWT_SIGNING_KEY),
    process_env_worker: fingerprint(process.env.WORKER_URL),
    process_env_pin: fingerprint(process.env.PIN_PLAIN),
    ctx_env_jwt: ctxJwt,
    ctx_env_worker: ctxWorker,
    ctx_env_keys: ctxEnvKeys,
  });
}
