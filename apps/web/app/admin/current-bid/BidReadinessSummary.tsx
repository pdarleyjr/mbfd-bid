'use client';

import { Button } from '@/components/ui/button';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

type EditSection = 'flow' | 'a-day';

type ReadinessItemProps = {
  label: string;
  status: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: 'ready' | 'review';
};

function ReadinessItem({ label, status, children, action, tone = 'review' }: ReadinessItemProps) {
  return (
    <li className="grid gap-2 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)_auto] sm:items-center">
      <p className="font-medium">
        {label}: {status}
      </p>
      <p className={tone === 'ready' ? 'text-sm text-muted-foreground' : 'text-sm'}>{children}</p>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </li>
  );
}

/**
 * A compact operating checklist for the Current Bid. It intentionally reports
 * only facts already represented by the saved Bid and directs the administrator
 * to the established review workspaces; it never treats a checklist row as
 * permission to create or start a Live Bid.
 */
export function BidReadinessSummary({
  year,
  policyReady,
  realActivationReviewCount,
  positionsReady,
  participantStagesConfigured,
  aDayConfigured,
  onOpenEdit,
  onOpenMock,
  onOpenLive,
}: {
  year: number;
  policyReady: boolean;
  realActivationReviewCount: number;
  positionsReady: boolean;
  participantStagesConfigured: boolean;
  aDayConfigured: boolean;
  onOpenEdit(section: EditSection): void;
  onOpenMock(): void;
  onOpenLive(): void;
}) {
  return (
    <section
      aria-labelledby="bid-readiness-heading"
      className="rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {year} BID READINESS
          </p>
          <h2 id="bid-readiness-heading" className="mt-1 font-heading text-xl">
            What to do next
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Prepare and practice a Mock with saved working assumptions. Real remains separately
            fail-closed until every activation review is resolved.
          </p>
        </div>
        <Link
          href={'/admin/guide#2026-bid-quick-start' as Route}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Open 2026 Quick Start
        </Link>
      </div>
      <ul className="mt-4">
        <ReadinessItem
          label="Policy"
          status={policyReady ? 'Ready' : 'Review required'}
          tone={policyReady ? 'ready' : 'review'}
          action={
            !policyReady ? (
              <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
                Review policy
              </Button>
            ) : undefined
          }
        >
          {policyReady
            ? realActivationReviewCount > 0
              ? `The working policy can support a Mock. ${realActivationReviewCount} Real activation reviews remain.`
              : 'The saved Bid has a complete working policy and no open Real activation review.'
            : 'A policy setting or configuration-level source decision still needs administrator review.'}
        </ReadinessItem>
        <ReadinessItem
          label="Positions"
          status={positionsReady ? 'Ready' : 'Rules need review'}
          tone={positionsReady ? 'ready' : 'review'}
          action={
            !positionsReady ? (
              <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
                Review positions
              </Button>
            ) : undefined
          }
        >
          {positionsReady
            ? 'Every current biddable opportunity has a valid rule.'
            : 'At least one biddable opportunity is missing or has an invalid rule.'}
        </ReadinessItem>
        <ReadinessItem
          label="Bid order"
          status={
            participantStagesConfigured
              ? 'Preview participant stages'
              : 'Participant stages need setup'
          }
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
              Review participants
            </Button>
          }
        >
          {participantStagesConfigured
            ? 'Review the captured participant list, visible include/exclude exceptions, and governing Bid-order evidence.'
            : 'Add the saved participant sources before the server can review who will bid and in what order.'}
        </ReadinessItem>
        <ReadinessItem
          label="Credentials"
          status="Provisional source review required"
          action={
            <Link
              href={'/admin/targetsolutions' as Route}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              Review credentials
            </Link>
          }
        >
          Compare the current TargetSolutions export before applying reviewed qualification
          evidence. An active-only report never expires or removes a qualification; refresh with the
          final post-September 30 export through the same workflow.
        </ReadinessItem>
        <ReadinessItem
          label="A-Day timing"
          status={aDayConfigured ? 'Configured' : 'Source-backed timing is still needed'}
          tone={aDayConfigured ? 'ready' : 'review'}
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('a-day')}>
              Review A-Day
            </Button>
          }
        >
          {aDayConfigured
            ? 'Review the saved timing, limits, exceptions, and their policy references.'
            : 'Add the approved timing source and limits before relying on A-Day controls.'}
        </ReadinessItem>
        <ReadinessItem
          label="Operator"
          status="Confirm permissions"
          action={
            <Button type="button" variant="secondary" onClick={onOpenLive}>
              Review operator access
            </Button>
          }
        >
          Confirm that the authorized Bid operator is signed in before creating any session. The
          server remains the authority for Live permissions.
        </ReadinessItem>
        <ReadinessItem
          label="Mock rehearsal"
          status={policyReady ? 'Ready to prepare safely' : 'Working setup required'}
          tone={policyReady ? 'ready' : 'review'}
          action={
            <Button type="button" variant="secondary" onClick={onOpenMock}>
              Prepare Mock
            </Button>
          }
        >
          {policyReady
            ? 'A Mock can use the saved working assumptions without granting Real authority.'
            : 'Finish the working setup, then practice selections, unreachable-member handling, and specialty fallback.'}
        </ReadinessItem>
        <ReadinessItem
          label="Live"
          status={
            realActivationReviewCount > 0
              ? `${realActivationReviewCount} activation reviews remain`
              : 'Check final readiness'
          }
          action={
            <Button type="button" variant="secondary" onClick={onOpenLive}>
              Check Managed Live readiness
            </Button>
          }
        >
          The Managed Live check is read-only. It does not create or start the real Bid.
        </ReadinessItem>
      </ul>
    </section>
  );
}
