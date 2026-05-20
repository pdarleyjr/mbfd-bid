// Plan 09 / Rehearsal Tooling — Task R9.
//
// Server-rendered table of mock bid sessions with action buttons (reset,
// auto-bid, verify audit chain). Action affordances are delegated to the
// AutoBidButton client island so the table itself stays a Server Component.

import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { AutoBidButton } from './AutoBidButton';
import { ResetMockButton } from './ResetMockButton';
import { VerifyAuditButton } from './VerifyAuditButton';

export interface MockSessionRow {
  id: string;
  bidYear: number;
  currentPhase: string;
  currentBidderId: number | null;
  isMock: boolean;
  costCents: number;
  lastPickedAtIso: string | null;
}

interface Props {
  sessions: MockSessionRow[];
}

export function MockSessionsTable({ sessions }: Props): ReactElement {
  if (sessions.length === 0) {
    return (
      <div className="rounded border border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-600">
        <p>No mock sessions yet.</p>
        <Link
          href={'/admin/sessions/new?mock=1' as Route}
          className="mt-3 inline-flex min-h-10 items-center rounded bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-600"
        >
          Create mock session
        </Link>
      </div>
    );
  }
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead className="bg-stone-100 text-left">
        <tr>
          <th className="border border-stone-300 px-3 py-2">Session ID</th>
          <th className="border border-stone-300 px-3 py-2">Year</th>
          <th className="border border-stone-300 px-3 py-2">Phase</th>
          <th className="border border-stone-300 px-3 py-2">Current bidder</th>
          <th className="border border-stone-300 px-3 py-2">Last pick</th>
          <th className="border border-stone-300 px-3 py-2">AI cost</th>
          <th className="border border-stone-300 px-3 py-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.id} data-testid={`mock-session-row-${s.id}`}>
            <td className="border border-stone-300 px-3 py-2 font-mono">{s.id}</td>
            <td className="border border-stone-300 px-3 py-2">{s.bidYear}</td>
            <td className="border border-stone-300 px-3 py-2">{s.currentPhase}</td>
            <td className="border border-stone-300 px-3 py-2">{s.currentBidderId ?? '—'}</td>
            <td className="border border-stone-300 px-3 py-2">
              {s.lastPickedAtIso ? new Date(s.lastPickedAtIso).toLocaleString() : '—'}
            </td>
            <td className="border border-stone-300 px-3 py-2 tabular-nums">
              ${(s.costCents / 100).toFixed(2)}
            </td>
            <td className="border border-stone-300 px-3 py-2">
              <div className="flex flex-wrap gap-2">
                <ResetMockButton sessionId={s.id} />
                <AutoBidButton sessionId={s.id} strategy="first_eligible" count={10} />
                <AutoBidButton sessionId={s.id} strategy="ai_top" count={10} />
                <VerifyAuditButton sessionId={s.id} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
