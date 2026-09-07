'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

/**
 * Single shared TanStack Query client for the entire /admin section.
 *
 * Anchored in the admin layout so every client component below it can call
 * `useQuery` / `useMutation` without each page setting up its own provider.
 *
 * `useState` (not `useMemo`) is the React-recommended pattern for keeping a
 * stable client across re-renders without re-creating it during Strict Mode
 * double-invocation. See https://tanstack.com/query/latest/docs/framework/react/guides/ssr.
 */
export function AdminQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
