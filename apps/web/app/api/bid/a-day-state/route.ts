import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const FORWARDED_RESPONSE_HEADERS = ['cache-control', 'content-type', 'etag'] as const;

function forwardedResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/**
 * Cookie-authenticated same-origin read proxy for the A-Day board. The
 * browser never receives or sends the access JWT to the Worker directly.
 */
export async function GET(request: Request): Promise<Response> {
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  if (!jwt) return NextResponse.json({ error: 'missing_auth' }, { status: 401 });

  const sessionId = new URL(request.url).searchParams.get('session');
  if (sessionId === null || sessionId.length === 0 || sessionId.length > 160) {
    return NextResponse.json({ error: 'invalid_session' }, { status: 400 });
  }

  const workerUrl = new URL('/api/bid/a-day-state', getWorkerBase());
  workerUrl.searchParams.set('session', sessionId);
  try {
    const headers = new Headers({ authorization: `Bearer ${jwt}` });
    const upstream = await fetch(workerUrl.toString(), {
      method: 'GET',
      headers,
    });
    return forwardedResponse(upstream);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'fetch failed';
    return NextResponse.json({ error: 'worker_unavailable', detail }, { status: 503 });
  }
}
