// Plan 08 Task 26 — Admin exports + portal sync status page.

import type { ReactElement } from 'react';

import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { DirectCsvExports } from './_components/DirectCsvExports';
import { ExportCard } from './_components/ExportCard';
import { ExportTriggerButton } from './_components/ExportTriggerButton';
import { PortalSyncStatus } from './_components/PortalSyncStatus';
import {
  type ActiveExportSession,
  SessionSelectionPanel,
} from './_components/SessionSelectionPanel';

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

interface ActiveSessionResponse {
  session: ActiveExportSession | null;
}

function validSessionId(value: string | undefined): string | null {
  if (value === undefined || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) return null;
  return value;
}

async function fetchActiveSession(): Promise<{
  session: ActiveExportSession | null;
  fetchError: string | null;
}> {
  try {
    const response = await serverWorkerFetch('/api/admin/bid-session/active');
    if (!response.ok) {
      return { session: null, fetchError: `Active-session service returned ${response.status}.` };
    }
    const body = (await response.json()) as ActiveSessionResponse;
    const session = body.session;
    if (
      session === null ||
      typeof session !== 'object' ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(session.id) ||
      !Number.isSafeInteger(session.bidYear) ||
      typeof session.isMock !== 'boolean' ||
      typeof session.currentPhase !== 'string'
    ) {
      return { session: null, fetchError: null };
    }
    return { session, fetchError: null };
  } catch (caught) {
    return {
      session: null,
      fetchError:
        caught instanceof Error
          ? 'The active-session service could not be reached.'
          : 'fetch failed',
    };
  }
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
  const { session_id: requestedSessionId } = await searchParams;
  const sid = validSessionId(requestedSessionId);
  if (sid === null) {
    const active = await fetchActiveSession();
    return (
      <main className="admin-exports mx-auto max-w-6xl space-y-6">
        <h1 className="font-heading text-3xl font-bold">Exports &amp; Portal Sync</h1>
        <p>Select the Bid session whose progress, awards, roster, and audit evidence you need.</p>
        <SessionSelectionPanel
          activeSession={active.session}
          error={
            requestedSessionId === undefined
              ? active.fetchError
              : 'The selected session link is invalid. Return to its session controls and choose the action again.'
          }
        />
      </main>
    );
  }
  const [exportsResult, portalResult] = await Promise.all([
    fetchExports(sid),
    fetchPortalStatus(sid),
  ]);

  return (
    <main className="admin-exports mx-auto max-w-6xl space-y-6">
      <h1 className="font-heading text-3xl font-bold">Exports &amp; Portal Sync</h1>
      <p>Session evidence selected from the Bid session controls.</p>

      <DirectCsvExports sessionId={sid} />

      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold">Generate</h2>
        <div className="flex flex-wrap gap-3">
          {(['A', 'B', 'C', 'D'] as const).map((sh) => (
            <ExportTriggerButton key={sh} kind="roster" shift={sh} sessionId={sid} />
          ))}
          <ExportTriggerButton kind="audit-csv" sessionId={sid} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold">Available exports</h2>
        {exportsResult.fetchError !== null && (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-warning"
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
        <h2 className="mb-3 font-heading text-lg font-semibold">Portal sync status</h2>
        {portalResult.fetchError !== null && (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-warning"
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
