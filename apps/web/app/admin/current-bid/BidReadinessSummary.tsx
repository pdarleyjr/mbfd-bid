'use client';

import { Button } from '@/components/ui/button';
import { type BidDefinitionContent, evaluate2026RankCapacity } from '@mbfd/shared';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

type EditSection = 'flow' | 'a-day' | 'authority';

type ReadinessItemProps = {
  label: string;
  status: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: 'ready' | 'review' | 'blocking';
};

function ReadinessItem({ label, status, children, action, tone = 'review' }: ReadinessItemProps) {
  return (
    <li className="grid gap-2 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)_auto] sm:items-center">
      <p className="font-medium">
        {label}: {status}
      </p>
      <p
        className={
          tone === 'ready'
            ? 'text-sm text-muted-foreground'
            : tone === 'blocking'
              ? 'text-sm text-destructive'
              : 'text-sm'
        }
      >
        {children}
      </p>
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
  content,
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
  content: BidDefinitionContent;
  policyReady: boolean;
  realActivationReviewCount: number;
  positionsReady: boolean;
  participantStagesConfigured: boolean;
  aDayConfigured: boolean;
  onOpenEdit(section: EditSection): void;
  onOpenMock(): void;
  onOpenLive(): void;
}) {
  const rankCapacity = (() => {
    if (
      !content.sourceDecisions.some(
        (decision) =>
          decision.issueId === '2026-b-rescue-float-rank-correction' &&
          decision.status === 'RESOLVED',
      )
    )
      return null;
    try {
      return evaluate2026RankCapacity(content, content.policy?.executionPolicy.stages ?? []);
    } catch {
      return null;
    }
  })();
  const ranksReady =
    rankCapacity !== null &&
    JSON.stringify(rankCapacity.capacity) === JSON.stringify({ CPT: 23, LT: 39, FF: 161 }) &&
    (rankCapacity.shortages.length === 0 ||
      (rankCapacity.shortages.every(
        (s) => s.rank === 'LT' && s.bidders === 40 && s.capacity === 39,
      ) &&
        content.sourceDecisions.some(
          (d) =>
            d.issueId === '2026-latest-lieutenant-capacity' &&
            d.status === 'OPEN' &&
            d.blockingClassification === 'BLOCKS_REAL_BID_ACTIVATION',
        )));
  const shiftCounts = { A: 0, B: 0, C: 0, D: 0 };
  const participation = new Map(
    content.participation.map((item) => [item.positionId, item.bidParticipation]),
  );
  for (const position of content.positions) {
    if (participation.get(position.id) !== 'BIDDABLE') continue;
    if (position.shift in shiftCounts) shiftCounts[position.shift as keyof typeof shiftCounts] += 1;
  }
  const shiftInventoryReady =
    rankCapacity !== null &&
    shiftCounts.A === 73 &&
    shiftCounts.B === 73 &&
    shiftCounts.C === 73 &&
    shiftCounts.D === 4 &&
    Object.values(shiftCounts).reduce((sum, count) => sum + count, 0) === 223;
  const mockReady =
    policyReady && positionsReady && participantStagesConfigured && aDayConfigured && ranksReady;
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
            Prepare and practice a Mock with saved working assumptions. The saved configuration has{' '}
            {realActivationReviewCount} open source or evidence{' '}
            {realActivationReviewCount === 1 ? 'review' : 'reviews'}. Open Live Bid and run its
            read-only server preflight for the specific blockers, sources and fix path. Real remains
            closed until that check passes.
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
          label="Source package"
          status={policyReady ? 'Ready' : 'Blocking'}
          tone={policyReady ? 'ready' : 'blocking'}
          action={
            !policyReady ? (
              <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
                Review source decisions
              </Button>
            ) : undefined
          }
        >
          {policyReady
            ? 'The saved version identifies its governing policy, source workbook, evidence dates, and dated administrative decisions.'
            : 'A governing source or configuration-level decision is missing.'}
        </ReadinessItem>
        <ReadinessItem
          label="Positions"
          status={positionsReady ? 'Ready' : 'Blocking'}
          tone={positionsReady ? 'ready' : 'blocking'}
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
        {year === 2026 && (
          <ReadinessItem
            label="Biddable seat inventory"
            status={shiftInventoryReady ? 'Ready' : 'Blocking'}
            tone={shiftInventoryReady ? 'ready' : 'blocking'}
            action={
              <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
                Review opportunity participation
              </Button>
            }
          >
            A {shiftCounts.A} · B {shiftCounts.B} · C {shiftCounts.C} · Days {shiftCounts.D}.
            Expected: 73 per shift, four open Days seats, 223 total. Division Chiefs, the Union
            President and closed Days seats do not bid.
          </ReadinessItem>
        )}
        <ReadinessItem
          label="Rank opportunities and bidders"
          status={
            ranksReady && rankCapacity?.shortages.length
              ? 'Practice assumption — Real only'
              : ranksReady
                ? 'Ready'
                : 'Blocking'
          }
          tone={ranksReady ? 'ready' : 'blocking'}
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
              Review participants
            </Button>
          }
        >
          {rankCapacity
            ? `Opportunities: ${rankCapacity.capacity.CPT} Captains, ${rankCapacity.capacity.LT} Lieutenants, ${rankCapacity.capacity.FF} Firefighters. Bidders: ${rankCapacity.bidders.CPT}, ${rankCapacity.bidders.LT}, ${rankCapacity.bidders.FF}. Expected vacancies: ${rankCapacity.expectedVacancies.CPT} Captain, ${rankCapacity.expectedVacancies.LT} Lieutenant, ${rankCapacity.expectedVacancies.FF} Firefighter.`
            : 'Save the reviewed 2026 topology and participant stages to reconcile opportunities by rank.'}
        </ReadinessItem>
        <ReadinessItem
          label="Participants"
          status={participantStagesConfigured ? 'Ready' : 'Blocking'}
          tone={participantStagesConfigured ? 'ready' : 'blocking'}
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
          label="Seniority / order"
          status={participantStagesConfigured ? 'Ready' : 'Blocking'}
          tone={participantStagesConfigured ? 'ready' : 'blocking'}
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
              Review ordering evidence
            </Button>
          }
        >
          Captain and Lieutenant order uses the reviewed time-in-grade Bid ordinal; Firefighter
          order uses the reviewed department-service Bid ordinal. No employee-ID or alphabetical
          fallback is permitted.
        </ReadinessItem>
        <ReadinessItem
          label="Credentials"
          status="Needs Confirmation"
          action={
            <Link
              href={'/admin/targetsolutions' as Route}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              Review credentials
            </Link>
          }
        >
          The saved Bid evaluates credentials as of{' '}
          {content.settings && content.settings.v !== 1
            ? content.settings.credentialEvaluationOn
            : 'the configured date'}
          . A later approved TargetSolutions or TeleStaff report can add, renew, correct, revoke, or
          explicitly remove evidence; omission from a filtered report never removes a qualification.
        </ReadinessItem>
        <ReadinessItem
          label="Specialty populations"
          status={policyReady ? 'Ready' : 'Blocking'}
          tone={policyReady ? 'ready' : 'blocking'}
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
              Review specialties
            </Button>
          }
        >
          Review qualification-based specialized stages and the fixed six-member SWAT distribution
          before rehearsal.
        </ReadinessItem>
        <ReadinessItem
          label="A-Day constraints"
          status={aDayConfigured ? 'Ready' : 'Blocking'}
          tone={aDayConfigured ? 'ready' : 'blocking'}
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('a-day')}>
              Review A-Day
            </Button>
          }
        >
          {aDayConfigured
            ? 'Review the saved timing, limits, exceptions, and their policy references.'
            : 'Save the four-group mapping and the explicit Marine, SWAT, DE, and policy-backed constraints before rehearsal.'}
        </ReadinessItem>
        <ReadinessItem
          label="Operators / permissions"
          status="Needs Confirmation"
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('authority')}>
              Review operator access
            </Button>
          }
        >
          Review the saved, editable action grants in this annual version. Operator authority is
          independent of bidder participation; the server checks the signed-in operator for Live.
        </ReadinessItem>
        <ReadinessItem
          label="Operating settings"
          status="Needs Confirmation"
          action={
            <Button type="button" variant="secondary" onClick={() => onOpenEdit('flow')}>
              Review operating settings
            </Button>
          }
        >
          Confirm the staffing transition effective date before Live. Evaluation dates, three-day
          duration, 300-second timer, and operator-discretion contact handling remain editable and
          auditable.
        </ReadinessItem>
        <ReadinessItem
          label="Mock rehearsal"
          status={mockReady ? 'Ready' : 'Blocking'}
          tone={mockReady ? 'ready' : 'blocking'}
          action={
            <Button type="button" variant="secondary" onClick={onOpenMock}>
              Prepare Mock
            </Button>
          }
        >
          {mockReady
            ? 'A Mock can use the saved working assumptions without granting Real authority.'
            : 'Finish the source, positions, participants, ordering, and A-Day setup, then practice selections, unreachable-member handling, and specialty fallback.'}
        </ReadinessItem>
        <ReadinessItem
          label="Live readiness"
          status="Needs Confirmation"
          action={
            <Button type="button" variant="secondary" onClick={onOpenLive}>
              Check Managed Live readiness
            </Button>
          }
        >
          Run the server check to see the exact blockers and their sources. It does not create or
          start the real Bid.
        </ReadinessItem>
      </ul>
    </section>
  );
}
