import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request): Promise<Response> {
  const store = await cookies();
  const jwt = store.get(JWT_COOKIE_NAME)?.value;
  if (!jwt) return NextResponse.json({ error: 'missing_auth' }, { status: 401 });
  const incoming = new URL(request.url);
  const upstreamUrl = new URL(`/api/presentation${incoming.search}`, getWorkerBase());
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: { authorization: `Bearer ${jwt}`, accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'worker_unavailable',
        detail: error instanceof Error ? error.message : 'fetch failed',
      },
      { status: 503 },
    );
  }
  const refreshed = upstream.headers.get('X-MBFD-Session-Refresh');
  if (refreshed) store.set(JWT_COOKIE_NAME, refreshed, JWT_COOKIE_OPTS);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
