import type { Route } from 'next';
import Link from 'next/link';

export interface ActiveExportSession {
  id: string;
  bidYear: number;
  isMock: boolean;
  currentPhase: string;
}

function sessionHref(sessionId: string): Route {
  return `/admin/exports?${new URLSearchParams({ session_id: sessionId }).toString()}` as Route;
}

function sessionLabel(session: ActiveExportSession): string {
  return `${session.bidYear} ${session.isMock ? 'rehearsal' : 'Bid'} session exports`;
}

/**
 * Export selection deliberately comes from authenticated session context. It
 * never turns an internal session key into a form field an operator must copy.
 */
export function SessionSelectionPanel({
  activeSession,
  error,
}: {
  activeSession: ActiveExportSession | null;
  error: string | null;
}) {
  if (activeSession !== null) {
    return (
      <section className="mt-6 max-w-3xl rounded-xl border border-slate-700 bg-slate-800/40 p-5">
        <h2 className="font-heading text-lg text-white">Select a session</h2>
        <p className="mt-1 text-sm text-slate-300">
          Open the verified active session below. Historical and completed sessions are opened from
          their own session controls so no internal identifier needs to be copied.
        </p>
        <Link
          href={sessionHref(activeSession.id)}
          className="mt-4 inline-flex min-h-11 items-center rounded border border-sky-700 bg-sky-950/30 px-4 py-2 text-sm font-semibold text-sky-100 hover:border-sky-400 hover:text-white"
        >
          Open {sessionLabel(activeSession)}
        </Link>
        <p className="mt-3 text-xs text-slate-400">
          Current phase: {activeSession.currentPhase.replaceAll('_', ' ')}.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 max-w-3xl rounded-xl border border-amber-700 bg-amber-950/30 p-5 text-sm text-amber-100">
      <h2 className="font-semibold">No active session is available</h2>
      <p className="mt-1">
        Open exports from a Bid session&apos;s session controls. This page will not accept a copied
        internal session identifier.
      </p>
      {error !== null && <p className="mt-2 text-amber-100/90">{error}</p>}
    </section>
  );
}
