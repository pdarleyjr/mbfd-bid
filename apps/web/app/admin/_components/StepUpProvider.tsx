'use client';

import { type ReactNode, useEffect, useState } from 'react';

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
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
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

      const pendingDrafts: Promise<unknown>[] = [];
      window.dispatchEvent(new CustomEvent('mbfd-before-step-up', { detail: pendingDrafts }));
      const outcome = await Promise.race([
        Promise.allSettled(pendingDrafts),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
      ]);
      if (outcome === null || outcome.some((result) => result.status === 'rejected')) {
        setDraftSaveFailed(true);
        return response;
      }
      window.location.assign(
        stepUpAuthenticationPath(window.location.pathname, window.location.search),
      );
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <>
      {draftSaveFailed && (
        <aside role="alert" className="m-4 rounded border border-warning p-4">
          Your unfinished work could not be saved, so this page has been kept open.{' '}
          <a
            className="underline"
            href="/api/auth/start?returnTo=%2Fadmin"
            target="_blank"
            rel="noreferrer"
          >
            Sign in again in a new tab
          </a>
          , then return here and retry saving.
        </aside>
      )}
      {children}
    </>
  );
}
