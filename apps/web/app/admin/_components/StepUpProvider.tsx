'use client';

import { type ReactNode, useEffect } from 'react';

interface StepUpProviderProps {
  children: ReactNode;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function stepUpAuthenticationPath(pathname: string, search: string): string {
  const returnTo = `${pathname}${search}`;
  return `/api/auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

function isAdminApiRequest(input: FetchInput): boolean {
  const url =
    input instanceof Request
      ? new URL(input.url, window.location.origin)
      : new URL(String(input), window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/admin/');
}

export function StepUpProvider({ children }: StepUpProviderProps) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
      if (!isAdminApiRequest(input)) return originalFetch(input, init);

      const response = await originalFetch(input, init);
      if (response.status !== 401) return response;

      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      if (body?.error !== 'step_up_required') return response;

      window.location.assign(
        stepUpAuthenticationPath(window.location.pathname, window.location.search),
      );
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return children;
}
