import { requireAdmin } from '@/lib/require-admin';

/**
 * Deliberately read-only until an approved TeleStaff baseline and reviewed
 * position bindings exist. It must not be confused with the member bid-order
 * roster or imply that operational staffing was imported.
 */
export default async function CurrentRostersPage() {
  await requireAdmin();

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="current-rosters-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Staffing projection
        </p>
        <h1 id="current-rosters-heading" className="mt-1 font-heading text-2xl text-white">
          Current Rosters
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Review the Bid-side canonical staffing projection by shift, station, unit, rank, vacancy,
          assignment status, and history.
        </p>
      </header>

      <div
        data-testid="current-rosters-baseline-blocker"
        className="border-l-4 border-amber-500 bg-amber-950/30 px-4 py-4 text-sm text-amber-100"
      >
        <p className="font-semibold">Authoritative staffing baseline not loaded</p>
        <p className="mt-1 text-amber-100/90">
          TeleStaff remains authoritative for operational staffing. Current-roster data will remain
          unavailable until an approved baseline and reviewed position bindings are in place.
        </p>
      </div>
    </section>
  );
}
