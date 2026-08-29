const CSRF_BOOTSTRAP_PATH = '/api/auth/csrf';
const CSRF_HEADER_NAME = 'X-MBFD-CSRF';

function isCsrfToken(value: unknown): value is string {
  return typeof value === 'string' && /^csrf_[0-9a-f-]{36}$/i.test(value);
}

function requestUrl(input: RequestInfo | URL, currentOrigin: string): URL | null {
  try {
    const value =
      input instanceof URL ? input.toString() : input instanceof Request ? input.url : input;
    return new URL(value, currentOrigin);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  return input instanceof Request ? input.method.toUpperCase() : 'GET';
}

function isScopedUnsafeRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  currentOrigin: string,
): boolean {
  const url = requestUrl(input, currentOrigin);
  if (url === null || url.origin !== new URL(currentOrigin).origin) return false;
  const method = requestMethod(input, init);
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return (
    url.pathname === '/api/admin' ||
    url.pathname.startsWith('/api/admin/') ||
    url.pathname === '/api/bid' ||
    url.pathname.startsWith('/api/bid/') ||
    url.pathname === '/api/auth/ws-ticket'
  );
}

async function readCsrfToken(fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(CSRF_BOOTSTRAP_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => null);
  const token =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).token
      : null;
  if (!response.ok || !isCsrfToken(token)) throw new Error('csrf_bootstrap_failed');
  return token;
}

/**
 * Creates a same-origin fetch wrapper that acquires one authenticated
 * double-submit CSRF token before forwarding a protected browser mutation.
 * The original request body (including FormData) is preserved.
 */
export function createCsrfAwareFetch(
  originalFetch: typeof fetch,
  getCurrentOrigin: () => string,
): typeof fetch {
  let tokenPromise: Promise<string> | null = null;

  async function getToken(): Promise<string> {
    if (tokenPromise === null) {
      tokenPromise = readCsrfToken(originalFetch).catch((error: unknown) => {
        tokenPromise = null;
        throw error;
      });
    }
    return tokenPromise;
  }

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const currentOrigin = getCurrentOrigin();
    if (!isScopedUnsafeRequest(input, init, currentOrigin)) return originalFetch(input, init);

    const token = await getToken();
    const inheritedHeaders = input instanceof Request ? input.headers : undefined;
    const headers = new Headers(init?.headers ?? inheritedHeaders);
    headers.set(CSRF_HEADER_NAME, token);
    return originalFetch(input, { ...init, headers });
  };
}
