import type { Route } from 'next';
import Link from 'next/link';

export function LegacyMemberImportRetiredPanel() {
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warning">
          Controlled workflow required
        </p>
        <h1 className="mt-2 text-3xl font-heading tracking-tight text-foreground">
          Legacy member import retired
        </h1>
        <p className="mt-3 text-foreground">
          This page does not upload or alter member records. A CSV import cannot provide the
          effective date, reason, idempotency receipt, and immutable lifecycle evidence required for
          the current roster.
        </p>
      </header>

      <section className="rounded-xl border border-warning/40 bg-warning-surface p-5">
        <h2 className="font-heading text-lg text-warning">Choose the controlled workflow</h2>
        <p className="mt-2 text-sm leading-6 text-warning">
          Reconcile an approved official staffing source through TeleStaff. Use the personnel
          lifecycle workspace for effective-dated employment, rank, seniority, probation, and
          assignment changes. Credential mutations remain unavailable until an approved
          effective-dated evidence workflow exists.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={'/admin/telestaff' as Route}
            className="inline-flex min-h-11 items-center rounded bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-destructive"
          >
            Open TeleStaff reconciliation
          </Link>
          <Link
            href={'/admin/personnel' as Route}
            className="inline-flex min-h-11 items-center rounded border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-border"
          >
            Open personnel lifecycle
          </Link>
        </div>
      </section>
    </div>
  );
}
