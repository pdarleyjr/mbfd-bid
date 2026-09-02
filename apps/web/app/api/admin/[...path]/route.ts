import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME, JWT_COOKIE_OPTS } from '@/lib/cookies';
import { csrfFailureForUnsafeRequest } from '@/lib/server-csrf';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'idempotency-key',
  'if-none-match',
  'if-modified-since',
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  'cache-control',
  'content-disposition',
  'content-type',
  'etag',
  'last-modified',
  'retry-after',
] as const;

function copyHeaders(source: Headers, names: readonly string[]): Headers {
  const target = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) target.set(name, value);
  }
  return target;
}

async function proxyAdminRequest(req: Request, context: RouteContext): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const csrfFailure = await csrfFailureForUnsafeRequest(req, cfEnv('ENV'));
    if (csrfFailure !== null) {
      return NextResponse.json({ error: `csrf_${csrfFailure}_forbidden` }, { status: 403 });
    }
  }

  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  if (!jwt) {
    return NextResponse.json({ error: 'missing_auth' }, { status: 401 });
  }

  const { path } = await context.params;
  const incomingUrl = new URL(req.url);
  const workerUrl = new URL(
    `/api/admin/${path.map(encodeURIComponent).join('/')}${incomingUrl.search}`,
    getWorkerBase(),
  );

  const headers = copyHeaders(req.headers, FORWARDED_REQUEST_HEADERS);
  headers.set('authorization', `Bearer ${jwt}`);

  let upstream: Response;
  try {
    const upstreamInit: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== null) {
      upstreamInit.body = req.body as unknown as BodyInit;
    }
    upstream = await fetch(workerUrl.toString(), upstreamInit);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'fetch failed';
    return NextResponse.json({ error: 'worker_unavailable', detail }, { status: 503 });
  }

  const refreshedJwt = upstream.headers.get('X-MBFD-Session-Refresh');
  if (refreshedJwt !== null) cookieStore.set(JWT_COOKIE_NAME, refreshedJwt, JWT_COOKIE_OPTS);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyHeaders(upstream.headers, FORWARDED_RESPONSE_HEADERS),
  });
}

export const GET = proxyAdminRequest;
export const POST = proxyAdminRequest;
export const PUT = proxyAdminRequest;
export const PATCH = proxyAdminRequest;
export const DELETE = proxyAdminRequest;
