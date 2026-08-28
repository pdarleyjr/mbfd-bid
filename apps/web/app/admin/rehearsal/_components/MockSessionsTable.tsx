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
    <div className="overflow-hidden rounded-lg border border-stone-300 bg-white text-stone-900 shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-stone-200 text-left text-stone-900">
          <tr>
            <th className="border-b border-stone-300 px-3 py-2 font-semibold">Session ID</th>
            <th className="border-b border-stone-300 px-3 py-2 font-semibold">Year</th>
            <th className="border-b border-stone-300 px-3 py-2 font-semibold">Phase</th>
            <th className="border-b border-stone-300 px-3 py-2 font-semibold">Current bidder</th>
            <th className="border-b border-stone-300 px-3 py-2 font-semibold">Last pick</th>
            <th className="border-b border-stone-300 px-3 py-2 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="text-stone-900">
          {sessions.map((s, idx) => (
            <tr
              key={s.id}
              data-testid={`mock-session-row-${s.id}`}
              className={idx % 2 === 0 ? 'bg-white' : 'bg-stone-50'}
            >
              <td className="border-t border-stone-200 px-3 py-2 font-mono text-xs text-stone-800">
                {s.id}
              </td>
              <td className="border-t border-stone-200 px-3 py-2 text-stone-900">{s.bidYear}</td>
              <td className="border-t border-stone-200 px-3 py-2 text-stone-900">
                {s.currentPhase}
              </td>
              <td className="border-t border-stone-200 px-3 py-2 text-stone-900">
                {s.currentBidderId ?? '—'}
              </td>
              <td className="border-t border-stone-200 px-3 py-2 text-stone-900">
                {s.lastPickedAtIso ? new Date(s.lastPickedAtIso).toLocaleString() : '—'}
              </td>
              <td className="border-t border-stone-200 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/bid?session_id=${encodeURIComponent(s.id)}` as Route}
                    className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                    data-testid={`watch-session-${s.id}`}
                  >
                    Open mock board
                  </Link>
                  <ResetMockButton sessionId={s.id} />
                  <AutoBidButton sessionId={s.id} strategy="first_eligible" count={10} />
                  <VerifyAuditButton sessionId={s.id} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
