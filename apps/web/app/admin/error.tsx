'use client';

// Global error boundary for /admin/* pages. Catches uncaught Server Component
// errors (and client-side errors that escape Suspense) and renders a useful
// message instead of the framework's generic "Server Components render error".

import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console so the user can grab the digest + message.
    console.error('[admin error]', error);
  }, [error]);

  return (
    <div className="rounded-lg border border-red-700 bg-red-950/30 p-6 text-sm text-red-100">
      <h2 className="font-heading text-lg text-white">Something went wrong on this page.</h2>
      <p className="mt-2 text-red-200">
        The admin page failed to render. This is almost always a Worker fetch returning an
        unexpected status (401, 500) or a missing binding. Use the digest below to look up the
        request in{' '}
        <code className="rounded bg-red-900 px-1">wrangler tail mbfd-bid-worker-staging</code>.
      </p>
      <dl className="mt-4 space-y-1 font-mono text-xs">
        <div>
          <dt className="inline text-red-300">message:</dt>{' '}
          <dd className="inline">{error.message || '(production build hides details)'}</dd>
        </div>
        {error.digest && (
          <div>
            <dt className="inline text-red-300">digest:</dt>{' '}
            <dd className="inline">{error.digest}</dd>
          </div>
        )}
      </dl>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
        >
          Try again
        </button>
        <a
          href="/admin"
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
