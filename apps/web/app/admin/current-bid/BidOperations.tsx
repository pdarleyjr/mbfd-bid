'use client';

import { Button } from '@/components/ui/button';
import { type BidDefinitionContent, evaluate2026RankCapacity } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { RealBidAccess } from '../_components/RealBidAccess';
import { annualGet } from '../annual-plan/annual-plan-client';
import { LatestCredentialSource } from '../targetsolutions/LatestCredentialSource';

export function BidOperations({
  year,
  content,
  versionId,
  createdMockId,
  createdRealId,
  disabled,
  ready,
  onCheckMock,
  onOpen,
}: {
  year: number;
  content: BidDefinitionContent;
  versionId: string | null;
  createdMockId?: string | null;
  createdRealId?: string | null;
  disabled: boolean;
  ready: boolean | null;
  onCheckMock(): void;
  onOpen(view: 'blueprint' | 'mock' | 'results' | 'live'): void;
}) {
  const existing = useQuery({
    queryKey: ['bid-my-mock', year, versionId],
    enabled: !!versionId,
    queryFn: () =>
      annualGet<{ mock: { id: string } | null }>(
        `bid/${year}/my-mock?versionId=${encodeURIComponent(versionId ?? '')}`,
      ),
  });
  let ranks: ReturnType<typeof evaluate2026RankCapacity> | null = null;
  try {
    if (year === 2026)
      ranks = evaluate2026RankCapacity(content, content.policy?.executionPolicy.stages ?? []);
  } catch {
    /* server readiness explains incomplete configuration */
  }
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  const biddable = new Set(
    content.participation.filter((p) => p.bidParticipation === 'BIDDABLE').map((p) => p.positionId),
  );
  for (const p of content.positions)
    if (biddable.has(p.id) && p.shift in counts) counts[p.shift as keyof typeof counts]++;
  const latest = content.sourceDecisions.some(
    (d) => d.issueId === '2026-latest-substantive-ranks' && d.status === 'RESOLVED',
  );
  const masterSource = content.sourceDecisions.some(
    (d) => d.issueId === '2026-master-v4-supersession' && d.status === 'RESOLVED',
  )
    ? 'MASTER V4'
    : 'MASTER V3';
  const realOnly = content.sourceDecisions.filter(
    (d) =>
      d.status === 'OPEN' &&
      (d.blockingClassification === 'BLOCKS_REAL_BID_ACTIVATION' ||
        d.blockingClassification === 'BLOCKS_FINAL_EVIDENCE_CERTIFICATION'),
  );
  const mock = createdMockId ? { id: createdMockId } : existing.data?.mock;
  const evidenceSealed = content.settings?.v === 3 && !!content.settings.evidenceFreeze;
  return (
    <section
      aria-labelledby="bid-operations-heading"
      className="space-y-3 border-y border-border bg-card p-4 sm:p-5"
    >
      <h2 id="bid-operations-heading" className="font-heading text-xl">
        Run the Bid
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <RealBidAccess
          year={year}
          createdRealId={createdRealId ?? null}
          onPrepare={() => onOpen('live')}
          disabled={disabled || !versionId}
        />
        <Button variant="primary" disabled={disabled || !versionId} onClick={onCheckMock}>
          New Mock Bid
        </Button>
        {mock ? (
          <Link
            href={`/admin/bid?session_id=${encodeURIComponent(mock.id)}` as Route}
            className="inline-flex min-h-11 items-center px-3 font-semibold underline"
          >
            Continue my Mock
          </Link>
        ) : null}
        <Button onClick={() => onOpen('results')}>Results</Button>
        <Link
          href="/admin/rehearsal"
          className="inline-flex min-h-11 items-center px-3 text-sm underline"
        >
          All Mocks
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        {disabled
          ? 'Save or resolve the current draft before creating a session.'
          : ready === false
            ? 'Review the Mock blockers below before practice.'
            : 'Both modes use the saved Bid. Each session keeps its own selections.'}
      </p>
      <details>
        <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
          Saved data, credentials and eligibility
        </summary>
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/targetsolutions"
              className="inline-flex min-h-11 items-center underline"
            >
              Update credentials
            </Link>
            <Button disabled={disabled} onClick={() => onOpen('blueprint')}>
              Review eligibility
            </Button>
          </div>
          {latest && (
            <p>
              <strong>Latest source:</strong> {masterSource} · Annual v5 · Credential revision shown
              below
            </p>
          )}
          {ranks && (
            <div className="space-y-1 text-sm">
              <p>
                <strong>Bidders:</strong> CPT {ranks.bidders.CPT} · LT {ranks.bidders.LT} · FF{' '}
                {ranks.bidders.FF} · Total {Object.values(ranks.bidders).reduce((a, b) => a + b, 0)}
              </p>
              <p>
                <strong>Seats:</strong> CPT {ranks.capacity.CPT} · LT {ranks.capacity.LT} · FF{' '}
                {ranks.capacity.FF} · Total{' '}
                {Object.values(ranks.capacity).reduce((a, b) => a + b, 0)} · A {counts.A} · B{' '}
                {counts.B} · C {counts.C} · Days {counts.D}
              </p>
              {ranks.shortages.map((s) => (
                <p key={s.rank} className="rounded border border-warning p-3">
                  <strong>{s.rank === 'LT' ? 'Lieutenant' : s.rank} count reconciliation</strong> —{' '}
                  {s.bidders} listed bidders and {s.capacity} open opportunities in this saved
                  version. Confirm participation and closed-position scope before treating this
                  difference as a staffing shortage.
                </p>
              ))}
            </div>
          )}
          <LatestCredentialSource />
          <div className="flex flex-wrap items-center gap-3">
            {mock && (
              <Link
                href={`/admin/eligibility?session_id=${encodeURIComponent(mock.id)}` as Route}
                className="inline-flex min-h-11 items-center underline"
              >
                Review my Mock’s eligibility / download lists
              </Link>
            )}
          </div>
          {realOnly.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer content-center font-semibold">
                Open source reviews ({realOnly.length})
              </summary>
              <ul className="list-disc space-y-2 pl-5 text-sm">
                {realOnly.map((d) => (
                  <li key={d.issueId}>{d.title}</li>
                ))}
              </ul>
            </details>
          )}
          {year === 2026 && (
            <p className="text-sm">
              {evidenceSealed
                ? 'Final personnel & credential snapshot sealed for the September 30, 5:00 PM Eastern cutoff and pinned to this saved Bid. Later evidence requires a separate audited review.'
                : 'Final personnel & credential snapshot — September 30, 5:00 PM Eastern cutoff. Use the sealed server receipt when available, then save and verify the final Bid version.'}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
