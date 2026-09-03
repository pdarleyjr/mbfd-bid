import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { CurrentRosterResponse } from '../CurrentRostersWorkspace';
import { PrintRosterDocument } from './PrintRosterDocument';

export const dynamic = 'force-dynamic';

export default async function CurrentRosterPrintPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const input = await searchParams;
  const query = new URLSearchParams(
    Object.entries(input).filter(([, value]) => value !== undefined) as Array<[string, string]>,
  );
  const response = await serverWorkerFetch(`/api/admin/current-roster?${query.toString()}`);
  if (!response.ok) return <main className="p-8">The printable roster could not be loaded.</main>;
  return <PrintRosterDocument roster={(await response.json()) as CurrentRosterResponse} />;
}
