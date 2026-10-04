import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
// Plan 09 / Rehearsal Tooling — Task R9.
//
// Server-rendered table of mock bid sessions with action buttons (reset,
// auto-bid, verify audit chain). Action affordances are delegated to the
// AutoBidButton client island so the table itself stays a Server Component.

import { presentationHref } from '@/lib/presentation-link';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { AutoBidButton } from './AutoBidButton';
import { CloseStaleMockButton } from './CloseStaleMockButton';
import { ResetMockButton } from './ResetMockButton';
import { VerifyAuditButton } from './VerifyAuditButton';

export interface MockSessionRow {
  id: string;
  bidYear: number;
  currentPhase: string;
  currentBidderId: number | null;
  /** D1-backed mock-only command revision; never a canonical DO sequence. */
  mockControlRevision: number | null;
  isMock: boolean;
  lastPickedAtIso: string | null;
}

interface Props {
  sessions: MockSessionRow[];
}

export function MockSessionsTable({ sessions }: Props): ReactElement {
  if (sessions.length === 0) {
    return (
      <div className="rounded border border-border bg-background p-6 text-center text-sm text-muted-foreground">
        <p>No mock sessions yet.</p>
        <Link
          href={'/admin/sessions/new?mock=1' as Route}
          className="mt-3 inline-flex min-h-10 items-center rounded bg-destructive px-4 py-2 font-medium text-primary-foreground hover:bg-destructive"
        >
          Create mock session
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {sessions.some((session) => session.currentPhase === 'paused') ? (
        <section
          aria-label="Paused Mock bids"
          className="rounded-lg border border-info/30 bg-info/5 p-4"
        >
          <h2 className="font-semibold">Continue a paused Mock</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your selections are saved. Open the same bid, then choose Resume bid.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {sessions
              .filter((session) => session.currentPhase === 'paused')
              .map((session, index) => (
                <Link
                  key={session.id}
                  href={`/admin/bid?session_id=${encodeURIComponent(session.id)}` as Route}
                  className="inline-flex min-h-11 items-center rounded border border-info/40 bg-card px-3 py-2 text-sm font-semibold underline"
                >
                  {session.bidYear} paused Mock {index + 1}
                  {session.lastPickedAtIso
                    ? ` · ${new Date(session.lastPickedAtIso).toLocaleString()}`
                    : ''}
                </Link>
              ))}
          </div>
        </section>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-sm">
        <Table className="w-full border-collapse text-sm">
          <TableHeader className="bg-muted text-left text-foreground">
            <TableRow>
              <TableHead className="border-b border-border px-3 py-2 font-semibold">
                Session ID
              </TableHead>
              <TableHead className="border-b border-border px-3 py-2 font-semibold">Year</TableHead>
              <TableHead className="border-b border-border px-3 py-2 font-semibold">
                Phase
              </TableHead>
              <TableHead className="border-b border-border px-3 py-2 font-semibold">
                Current bidder
              </TableHead>
              <TableHead className="border-b border-border px-3 py-2 font-semibold">
                Last pick
              </TableHead>
              <TableHead className="border-b border-border px-3 py-2 font-semibold">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-foreground">
            {sessions.map((s, idx) => (
              <TableRow
                key={s.id}
                data-testid={`mock-session-row-${s.id}`}
                className={idx % 2 === 0 ? 'bg-card' : 'bg-background'}
              >
                <TableCell className="border-t border-border px-3 py-2 font-mono text-xs text-foreground">
                  {s.id}
                </TableCell>
                <TableCell className="border-t border-border px-3 py-2 text-foreground">
                  {s.bidYear}
                </TableCell>
                <TableCell className="border-t border-border px-3 py-2 text-foreground">
                  {s.currentPhase}
                </TableCell>
                <TableCell className="border-t border-border px-3 py-2 text-foreground">
                  {s.currentBidderId ?? '—'}
                </TableCell>
                <TableCell className="border-t border-border px-3 py-2 text-foreground">
                  {s.lastPickedAtIso ? new Date(s.lastPickedAtIso).toLocaleString() : '—'}
                </TableCell>
                <TableCell className="border-t border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/bid?session_id=${encodeURIComponent(s.id)}` as Route}
                      className="rounded bg-success px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-success"
                      data-testid={`watch-session-${s.id}`}
                    >
                      {s.currentPhase === 'paused' ? 'Continue paused Mock' : 'Open mock board'}
                    </Link>
                    <a
                      href={presentationHref(s.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center rounded border border-border px-3 py-1 text-xs font-medium underline"
                    >
                      Open presentation
                    </a>
                    <details>
                      <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold">
                        More tools
                      </summary>
                      <div className="flex flex-wrap items-center gap-2 py-2">
                        <ResetMockButton sessionId={s.id} />
                        {s.currentPhase !== 'complete' ? (
                          <CloseStaleMockButton sessionId={s.id} />
                        ) : null}
                        <AutoBidButton
                          sessionId={s.id}
                          strategy="first_eligible"
                          count={10}
                          mockControlRevision={s.mockControlRevision}
                        />
                        <VerifyAuditButton sessionId={s.id} />
                      </div>
                    </details>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
