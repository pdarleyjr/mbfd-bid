// Plan 09 / Rehearsal Tooling — Task R9.
//
// /admin/rehearsal — Server Component dashboard for running mock-draft
// rehearsals. Lists mock sessions with action buttons (reset, auto-bid,
// verify audit chain), shows the most recent findings, and exposes a form
// for submitting new findings. Admin role-gated.

import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { cfEnv } from '../../../lib/cf-env';
import { JWT_COOKIE_NAME } from '../../../lib/cookies';
import { requireAdmin } from '../../../lib/require-admin';
import type { FindingRow } from './_components/FindingsList';
import { FindingsList } from './_components/FindingsList';
import type { MockSessionRow } from './_components/MockSessionsTable';
import { MockSessionsTable } from './_components/MockSessionsTable';
import { NewFindingForm } from './_components/NewFindingForm';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface SessionRowRaw {
  id: string;
  bidYear: number;
  currentPhase: string;
  currentBidderId: number | null;
  isMock: boolean;
  lastPickedAtIso: string | null;
}

async function fetchMockSessions(workerBase: string, jwt: string): Promise<SessionRowRaw[]> {
  const res = await fetch(`${workerBase}/api/admin/rehearsal/sessions`, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { sessions: SessionRowRaw[] };
  return body.sessions;
}

async function fetchRecentFindings(workerBase: string, jwt: string): Promise<FindingRow[]> {
  const res = await fetch(`${workerBase}/api/admin/rehearsal/findings-recent?limit=50`, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { findings: FindingRow[] };
  return body.findings;
}

async function fetchSessionCost(
  workerBase: string,
  jwt: string,
  sessionId: string,
): Promise<number> {
  try {
    const res = await fetch(
      `${workerBase}/api/admin/ai/cost?session_id=${encodeURIComponent(sessionId)}`,
      { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' },
    );
    if (!res.ok) return 0;
    const body = (await res.json()) as { cost_cents?: number };
    return body.cost_cents ?? 0;
  } catch {
    return 0;
  }
}

export default async function RehearsalDashboardPage(): Promise<ReactElement> {
  await requireAdmin();
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value ?? '';
  const workerBase = cfEnv('WORKER_URL') ?? cfEnv('WORKER_BASE_URL') ?? 'http://localhost:8787';

  const [rawSessions, findings] = await Promise.all([
    fetchMockSessions(workerBase, jwt),
    fetchRecentFindings(workerBase, jwt),
  ]);

  // Fan-out cost lookup per session in parallel. Costs are advisory; failures
  // surface as $0.00 in the table.
  const costs = await Promise.all(rawSessions.map((s) => fetchSessionCost(workerBase, jwt, s.id)));
  const sessions: MockSessionRow[] = rawSessions.map((s, i) => ({
    id: s.id,
    bidYear: s.bidYear,
    currentPhase: s.currentPhase,
    currentBidderId: s.currentBidderId,
    isMock: s.isMock,
    costCents: costs[i] ?? 0,
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
