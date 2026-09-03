import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { type CurrentRosterResponse, CurrentRostersWorkspace } from './CurrentRostersWorkspace';

export const dynamic = 'force-dynamic';

function validAsOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * Deliberately read-only until an approved TeleStaff baseline and reviewed
 * position bindings exist. It must not be confused with the member bid-order
 * roster or imply that operational staffing was imported.
 */
export default async function CurrentRostersPage({
  searchParams,
}: {
  searchParams: Promise<{
    as_of?: string;
    shift?: string;
    station?: string;
    division?: string;
    unit?: string;
    rank?: string;
  }>;
}) {
  await requireAdmin();

  const search = await searchParams;
  const asOf = validAsOf(search.as_of);
  const filterEntries = Object.entries({
    shift: search.shift,
    station: search.station,
    division: search.division,
    unit: search.unit,
    rank: search.rank,
  }).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].trim().length > 0,
  );
  const filters = Object.fromEntries(filterEntries) as Record<string, string>;
  const query = new URLSearchParams({ ...(asOf === undefined ? {} : { as_of: asOf }), ...filters });
  let roster: CurrentRosterResponse | null = null;
  let error: string | null = null;
  try {
    const response = await serverWorkerFetch(
      `/api/admin/current-roster${query.size === 0 ? '' : `?${query.toString()}`}`,
    );
    if (!response.ok) {
      error = `The staffing projection service returned ${response.status}.`;
    } else {
      roster = (await response.json()) as CurrentRosterResponse;
    }
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : 'The staffing projection could not be loaded.';
  }

  if (roster !== null) return <CurrentRostersWorkspace roster={roster} filters={filters} />;

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

      <div className="border-l-4 border-red-500 bg-red-950/30 px-4 py-4 text-sm text-red-100">
        <p className="font-semibold">Current roster data is temporarily unavailable</p>
        <p className="mt-1 text-amber-100/90">
          {error ??
            'Retry this screen after confirming the administrator session and Worker health.'}
        </p>
      </div>
    </section>
  );
}
