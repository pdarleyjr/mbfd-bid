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
    <div className="overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-sm">
      <Table className="w-full border-collapse text-sm">
        <TableHeader className="bg-muted text-left text-foreground">
          <TableRow>
            <TableHead className="border-b border-border px-3 py-2 font-semibold">
              Session ID
            </TableHead>
            <TableHead className="border-b border-border px-3 py-2 font-semibold">Year</TableHead>
            <TableHead className="border-b border-border px-3 py-2 font-semibold">Phase</TableHead>
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
                    Open mock board
                  </Link>
                  <ResetMockButton sessionId={s.id} />
                  {s.currentPhase !== 'complete' ? <CloseStaleMockButton sessionId={s.id} /> : null}
                  <AutoBidButton
                    sessionId={s.id}
                    strategy="first_eligible"
                    count={10}
                    mockControlRevision={s.mockControlRevision}
                  />
                  <VerifyAuditButton sessionId={s.id} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
