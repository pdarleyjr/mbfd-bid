// Plan 09 / Rehearsal Tooling — Task R9.
//
// /admin/rehearsal — Server Component dashboard for running mock-draft
// rehearsals. Lists mock sessions with action buttons (reset, auto-bid,
// verify audit chain), shows the most recent findings, and exposes a form
// for submitting new findings. Admin role-gated.

import type { ReactElement } from 'react';
import { requireAdmin } from '../../../lib/require-admin';
import { serverWorkerFetch } from '../../../lib/server-worker-fetch';
import type { FindingRow } from './_components/FindingsList';
import { FindingsList } from './_components/FindingsList';
import type { MockSessionRow } from './_components/MockSessionsTable';
import { MockSessionsTable } from './_components/MockSessionsTable';
import { NewFindingForm } from './_components/NewFindingForm';

export const dynamic = 'force-dynamic';

interface SessionRowRaw {
  id: string;
  bidYear: number;
  currentPhase: string;
  currentBidderId: number | null;
  isMock: boolean;
  lastPickedAtIso: string | null;
}

async function fetchMockSessions(): Promise<SessionRowRaw[]> {
  try {
    const res = await serverWorkerFetch('/api/admin/rehearsal/sessions');
    if (!res.ok) return [];
    const body = (await res.json()) as { sessions: SessionRowRaw[] };
    return body.sessions;
  } catch {
    return [];
  }
}

async function fetchRecentFindings(): Promise<FindingRow[]> {
  try {
    const res = await serverWorkerFetch('/api/admin/rehearsal/findings-recent?limit=50');
    if (!res.ok) return [];
    const body = (await res.json()) as { findings: FindingRow[] };
    return body.findings;
  } catch {
    return [];
  }
}

export default async function RehearsalDashboardPage(): Promise<ReactElement> {
  await requireAdmin();

  const [rawSessions, findings] = await Promise.all([fetchMockSessions(), fetchRecentFindings()]);

  const sessions: MockSessionRow[] = rawSessions.map((s) => ({
    id: s.id,
    bidYear: s.bidYear,
    currentPhase: s.currentPhase,
    currentBidderId: s.currentBidderId,
    isMock: s.isMock,
    lastPickedAtIso: s.lastPickedAtIso,
  }));

  const sessionIds = sessions.map((s) => s.id);

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="font-heading text-2xl text-white">Rehearsal Console</h1>
        <p className="text-sm text-slate-400">
          Mock-draft sessions are excluded from portal write-back.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 font-heading text-lg text-white">Active Mock Sessions</h2>
            <MockSessionsTable sessions={sessions} />
          </section>

          <section>
            <h2 className="mb-3 font-heading text-lg text-white">Recent Findings</h2>
            <FindingsList findings={findings} />
          </section>
        </div>

        <aside>
          <NewFindingForm sessionIds={sessionIds} />
        </aside>
      </div>
    </div>
  );
}
