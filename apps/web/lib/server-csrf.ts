import { cookies } from 'next/headers';

import { CSRF_COOKIE_NAME } from './cookies';
import { isExpectedPublicWebOrigin } from './public-web-origin';

export const CSRF_HEADER_NAME = 'x-mbfd-csrf';

export type CsrfFailure = 'origin' | 'token';

export function isSameOriginBrowserRequest(
  request: Request,
  environment: string | undefined,
): boolean {
  if (!isExpectedPublicWebOrigin(environment, request.headers.get('origin'))) return false;

  // Fetch Metadata is defense in depth. Older same-origin clients may omit
  // it, but a supplied non-same-origin value is never accepted.
  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite === null || fetchSite === 'same-origin';
}

export function isCsrfToken(value: unknown): value is string {
  return typeof value === 'string' && /^csrf_[0-9a-f-]{36}$/i.test(value);
}

export function createCsrfToken(): string {
  return `csrf_${crypto.randomUUID()}`;
}

/**
 * Validates the same-origin + double-submit CSRF boundary before a route
 * reads its authenticated access cookie or parses a potentially large body.
 */
export async function csrfFailureForUnsafeRequest(
  request: Request,
  environment: string | undefined,
): Promise<CsrfFailure | null> {
  if (!isSameOriginBrowserRequest(request, environment)) return 'origin';

  const provided = request.headers.get(CSRF_HEADER_NAME);
  const stored = (await cookies()).get(CSRF_COOKIE_NAME)?.value;
  if (!isCsrfToken(provided) || !isCsrfToken(stored) || provided !== stored) return 'token';
  return null;
}
