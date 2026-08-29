import type { Route } from 'next';
import Link from 'next/link';

export function LegacyMemberImportRetiredPanel() {
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
          Controlled workflow required
        </p>
        <h1 className="mt-2 text-3xl font-display tracking-tight text-white">
          Legacy member import retired
        </h1>
        <p className="mt-3 text-stone-300">
          This page does not upload or alter member records. A CSV import cannot provide the
          effective date, reason, idempotency receipt, and immutable lifecycle evidence required for
          the current roster.
        </p>
      </header>

      <section className="rounded-xl border border-amber-500/50 bg-amber-950/20 p-5">
        <h2 className="font-heading text-lg text-amber-100">Choose the controlled workflow</h2>
        <p className="mt-2 text-sm leading-6 text-amber-50/85">
          Reconcile an approved official staffing source through TeleStaff. Use the personnel
          lifecycle workspace for effective-dated employment, rank, seniority, probation, and
          assignment changes. Credential mutations remain unavailable until an approved
          effective-dated evidence workflow exists.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={'/admin/telestaff' as Route}
            className="inline-flex min-h-11 items-center rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
          >
            Open TeleStaff reconciliation
          </Link>
          <Link
            href={'/admin/personnel' as Route}
            className="inline-flex min-h-11 items-center rounded border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300"
          >
            Open personnel lifecycle
          </Link>
        </div>
      </section>
    </div>
  );
}
