import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { CurrentRosterResponse } from '../CurrentRostersWorkspace';
import { PrintRosterDocument } from './PrintRosterDocument';
import { buildCurrentRosterPrintQuery } from './query';

export const dynamic = 'force-dynamic';

export default async function CurrentRosterPrintPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const input = await searchParams;
  const query = buildCurrentRosterPrintQuery(input);
  const response = await serverWorkerFetch(
    `/api/admin/current-roster${query.size === 0 ? '' : `?${query.toString()}`}`,
  );
  if (!response.ok) return <main className="p-8">The printable roster could not be loaded.</main>;
  return <PrintRosterDocument roster={(await response.json()) as CurrentRosterResponse} />;
}
