'use client';

import { useEffect } from 'react';

import { createCsrfAwareFetch } from '@/lib/client-csrf';

/**
 * Ensures every client component shares the same CSRF-aware fetch path,
 * including multipart uploads whose callers cannot safely hand-roll headers.
 */
export function CsrfFetchBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch;
    const csrfFetch = createCsrfAwareFetch(originalFetch, () => window.location.origin);
    window.fetch = csrfFetch;
    return () => {
      if (window.fetch === csrfFetch) window.fetch = originalFetch;
    };
  }, []);

  return children;
}
