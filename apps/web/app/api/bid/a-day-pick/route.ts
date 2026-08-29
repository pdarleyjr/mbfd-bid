import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { csrfFailureForUnsafeRequest } from '@/lib/server-csrf';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const FORWARDED_RESPONSE_HEADERS = ['cache-control', 'content-type', 'retry-after'] as const;

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
 * Cookie-authenticated and CSRF-protected same-origin A-Day mutation proxy.
 * Only the server adds the access bearer while forwarding to the Worker.
 */
export async function POST(request: Request): Promise<Response> {
  const csrfFailure = await csrfFailureForUnsafeRequest(request, cfEnv('ENV'));
  if (csrfFailure !== null) {
    return NextResponse.json({ error: `csrf_${csrfFailure}_forbidden` }, { status: 403 });
  }

  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  if (!jwt) return NextResponse.json({ error: 'missing_auth' }, { status: 401 });

  const headers = new Headers({ authorization: `Bearer ${jwt}` });
  const contentType = request.headers.get('content-type');
  if (contentType !== null) headers.set('content-type', contentType);

  try {
    const upstream = await fetch(new URL('/api/bid/a-day-pick', getWorkerBase()).toString(), {
      method: 'POST',
      headers,
      body: request.body as unknown as BodyInit,
    });
    return forwardedResponse(upstream);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'fetch failed';
    return NextResponse.json({ error: 'worker_unavailable', detail }, { status: 503 });
  }
}
