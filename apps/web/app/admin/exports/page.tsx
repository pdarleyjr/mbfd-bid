// Plan 08 Task 26 — Admin exports + portal sync status page.

import type { ReactElement } from 'react';

import { ExportCard } from './_components/ExportCard';
import { ExportTriggerButton } from './_components/ExportTriggerButton';
import { PortalSyncStatus } from './_components/PortalSyncStatus';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ session_id?: string }>;
}

interface ExportRow {
  r2Key: string;
  kind: string;
  bytes: number;
  uploadedAt: string;
}

interface PortalBidRow {
  id: string;
  memberId: number;
  positionId: string;
  pickedAt: string;
  portalSyncStatus: string;
  portalSyncAttempts: number;
}

async function fetchExports(sid: string): Promise<{ exports: ExportRow[] }> {
  const base = process.env.WORKER_BASE_URL ?? 'https://api.staging.bid.mbfdhub.com';
  const res = await fetch(`${base}/api/admin/exports/${encodeURIComponent(sid)}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) return { exports: [] };
  return (await res.json()) as { exports: ExportRow[] };
}

async function fetchPortalStatus(sid: string): Promise<{ bids: PortalBidRow[] }> {
  const base = process.env.WORKER_BASE_URL ?? 'https://api.staging.bid.mbfdhub.com';
  const res = await fetch(`${base}/api/admin/portal-status/${encodeURIComponent(sid)}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) return { bids: [] };
  return (await res.json()) as { bids: PortalBidRow[] };
}

export default async function ExportsPage({ searchParams }: PageProps): Promise<ReactElement> {
  const { session_id: sid } = await searchParams;
  if (!sid) {
    return (
      <main className="admin-exports">
        <h1>Exports &amp; Portal Sync</h1>
        <p>Provide a session_id query parameter.</p>
      </main>
    );
  }
  const [exportsList, portalList] = await Promise.all([fetchExports(sid), fetchPortalStatus(sid)]);

  return (
    <main className="admin-exports">
      <h1>Exports &amp; Portal Sync — {sid}</h1>

      <section>
        <h2>Generate</h2>
        <div className="grid">
          {(['A', 'B', 'C', 'D'] as const).map((sh) => (
            <ExportTriggerButton key={sh} kind="roster" shift={sh} sessionId={sid} />
          ))}
          <ExportTriggerButton kind="audit-csv" sessionId={sid} />
        </div>
      </section>

      <section>
        <h2>Available exports</h2>
        {exportsList.exports.length === 0 ? (
          <p>No exports yet for this session.</p>
        ) : (
          exportsList.exports.map((e) => <ExportCard key={e.r2Key} entry={e} sessionId={sid} />)
        )}
      </section>

      <section>
        <h2>Portal sync status</h2>
        <PortalSyncStatus bids={portalList.bids} />
      </section>
    </main>
  );
}
