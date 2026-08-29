import type { Route } from 'next';
import Link from 'next/link';

function withSession(path: '/admin/exports' | '/admin/award-transition', sessionId: string): Route {
  const query = new URLSearchParams({ session_id: sessionId });
  return `${path}?${query.toString()}` as Route;
}

/**
 * Keeps downstream operator workflows attached to the session the operator
 * already opened, rather than asking them to copy an internal identifier.
 */
export function SessionOperatorLinks({ sessionId }: { sessionId: string }) {
  return (
    <nav aria-label="Session evidence actions" className="mt-5 flex flex-wrap gap-3">
      <Link
        href={withSession('/admin/exports', sessionId)}
        className="inline-flex min-h-11 items-center rounded border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300 hover:text-white"
      >
        Open session exports
      </Link>
      <Link
        href={withSession('/admin/award-transition', sessionId)}
        className="inline-flex min-h-11 items-center rounded border border-sky-700 bg-sky-950/30 px-4 py-2 text-sm font-semibold text-sky-100 hover:border-sky-400 hover:text-white"
      >
        Review current-to-new transition
      </Link>
    </nav>
  );
}
