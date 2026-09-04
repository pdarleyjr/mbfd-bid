import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { CurrentRosterResponse } from '../current-rosters/CurrentRostersWorkspace';
import { StaffingStructureWorkspace } from './StaffingStructureWorkspace';

export const dynamic = 'force-dynamic';

export default async function StaffingStructurePage({
  searchParams,
}: {
  searchParams: Promise<{ as_of?: string }>;
}) {
  await requireAdmin();
  const { as_of: requestedAsOf } = await searchParams;
  const query = requestedAsOf ? `?as_of=${encodeURIComponent(requestedAsOf)}` : '';
  const response = await serverWorkerFetch(`/api/admin/current-roster${query}`);
  if (!response.ok)
    return (
      <section className="rounded-xl border border-amber-700 bg-amber-950/30 p-5 text-amber-100">
        <h1 className="font-heading text-2xl">Staffing structure unavailable</h1>
        <p className="mt-2">
          The canonical staffing projection returned {response.status}. No fallback data is shown.
        </p>
      </section>
    );
  return <StaffingStructureWorkspace roster={(await response.json()) as CurrentRosterResponse} />;
}
