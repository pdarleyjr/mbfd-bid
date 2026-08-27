// Plan 08 Task 26 — Admin exports + portal sync status page.

import type { ReactElement } from 'react';

import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { ExportCard } from './_components/ExportCard';
import { ExportTriggerButton } from './_components/ExportTriggerButton';
import { PortalSyncStatus } from './_components/PortalSyncStatus';

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

async function fetchExports(
  sid: string,
): Promise<{ exports: ExportRow[]; fetchError: string | null }> {
  try {
    const res = await serverWorkerFetch(`/api/admin/exports/${encodeURIComponent(sid)}`);
    if (!res.ok) {
      return { exports: [], fetchError: `Worker returned ${res.status}` };
    }
    const body = (await res.json()) as { exports?: ExportRow[] };
    return { exports: body.exports ?? [], fetchError: null };
  } catch (e) {
    return { exports: [], fetchError: e instanceof Error ? e.message : 'fetch failed' };
  }
}

async function fetchPortalStatus(
  sid: string,
): Promise<{ bids: PortalBidRow[]; fetchError: string | null }> {
  try {
    const res = await serverWorkerFetch(`/api/admin/portal-status/${encodeURIComponent(sid)}`);
    if (!res.ok) {
      return { bids: [], fetchError: `Worker returned ${res.status}` };
    }
    const body = (await res.json()) as { bids?: PortalBidRow[] };
    return { bids: body.bids ?? [], fetchError: null };
  } catch (e) {
    return { bids: [], fetchError: e instanceof Error ? e.message : 'fetch failed' };
  }
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
  const [exportsResult, portalResult] = await Promise.all([
    fetchExports(sid),
    fetchPortalStatus(sid),
  ]);

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
        {exportsResult.fetchError !== null && (
          <div
            style={{
              border: '1px solid #b45309',
              background: 'rgba(120, 53, 15, 0.2)',
              color: '#fde68a',
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}
          >
            Could not load exports: {exportsResult.fetchError}. Check the Worker logs and JWT
            validity.
          </div>
        )}
        {exportsResult.fetchError === null && exportsResult.exports.length === 0 ? (
          <p>No exports yet for this session.</p>
        ) : (
          exportsResult.exports.map((e) => <ExportCard key={e.r2Key} entry={e} sessionId={sid} />)
        )}
      </section>

      <section>
        <h2>Portal sync status</h2>
        {portalResult.fetchError !== null && (
          <div
            style={{
              border: '1px solid #b45309',
              background: 'rgba(120, 53, 15, 0.2)',
              color: '#fde68a',
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}
          >
            Could not load portal sync status: {portalResult.fetchError}. Check the Worker logs and
            JWT validity.
          </div>
        )}
        {portalResult.fetchError === null && portalResult.bids.length === 0 ? (
          <p>No bids tracked for this session yet.</p>
        ) : (
          <PortalSyncStatus bids={portalResult.bids} />
        )}
      </section>
    </main>
  );
}
