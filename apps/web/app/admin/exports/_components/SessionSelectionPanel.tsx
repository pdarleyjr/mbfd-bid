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
      <section className="mt-6 max-w-3xl rounded-xl border border-border bg-card p-5">
        <h2 className="font-heading text-lg text-foreground">Select a session</h2>
        <p className="mt-1 text-sm text-foreground">
          Open the verified active session below. Historical and completed sessions are opened from
          their own session controls so no internal identifier needs to be copied.
        </p>
        <Link
          href={sessionHref(activeSession.id)}
          className="mt-4 inline-flex min-h-11 items-center rounded border border-info/40 bg-info-surface px-4 py-2 text-sm font-semibold text-info hover:border-info/40 hover:text-foreground"
        >
          Open {sessionLabel(activeSession)}
        </Link>
        <p className="mt-3 text-xs text-muted-foreground">
          Current phase: {activeSession.currentPhase.replaceAll('_', ' ')}.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 max-w-3xl rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning">
      <h2 className="font-semibold">No active session is available</h2>
      <p className="mt-1">
        Open exports from a Bid session&apos;s session controls. This page will not accept a copied
        internal session identifier.
      </p>
      {error !== null && <p className="mt-2 text-warning">{error}</p>}
    </section>
  );
}
