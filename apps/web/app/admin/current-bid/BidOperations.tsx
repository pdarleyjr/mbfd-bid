'use client';

import { Button } from '@/components/ui/button';
import { type BidDefinitionContent, evaluate2026RankCapacity } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { annualGet } from '../annual-plan/annual-plan-client';
import { LatestCredentialSource } from '../targetsolutions/LatestCredentialSource';

export function BidOperations({
  year,
  content,
  versionId,
  createdMockId,
  disabled,
  ready,
  onCheckMock,
  onOpen,
}: {
  year: number;
  content: BidDefinitionContent;
  versionId: string | null;
  createdMockId?: string | null;
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
  return (
    <section
      aria-labelledby="bid-operations-heading"
      className="space-y-4 rounded-lg border border-primary/40 bg-card p-5"
    >
      <h2 id="bid-operations-heading" className="font-heading text-xl">
        TODAY’S BID TASKS
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Link
          className="inline-flex min-h-12 items-center justify-center rounded border border-primary px-3 text-center font-semibold"
          href="/admin/targetsolutions"
        >
          UPDATE CREDENTIALS
        </Link>
        <Button disabled={disabled} onClick={() => onOpen('blueprint')}>
          CHECK CURRENT BID / ELIGIBILITY
        </Button>
        <Button disabled={disabled} onClick={() => onOpen('mock')}>
          RUN A MOCK BID
        </Button>
        <Button onClick={() => onOpen('results')}>VIEW RESULTS</Button>
        <Button onClick={() => onOpen('live')}>CHECK LIVE READINESS</Button>
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
            {ranks.capacity.FF} · Total {Object.values(ranks.capacity).reduce((a, b) => a + b, 0)} ·
            A {counts.A} · B {counts.B} · C {counts.C} · Days {counts.D}
          </p>
          {ranks.shortages.map((s) => (
            <p key={s.rank} className="rounded border border-warning p-3">
              <strong>
                {s.bidders - s.capacity} {s.rank === 'LT' ? 'Lieutenant' : s.rank} capacity
                shortfall
              </strong>{' '}
              — PRE-CUTOFF REHEARSAL CAPACITY ASSUMPTION. Real Bid requires an approved resolution.
            </p>
          ))}
        </div>
      )}
      <LatestCredentialSource />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-4">
        <p className="font-semibold">
          {mock || ready === true
            ? 'READY TO PRACTICE'
            : ready === false
              ? 'Review the Mock blockers below'
              : 'Check this saved version before practice'}
        </p>
        {mock ? (
          <Link
            href={`/admin/bid?session_id=${encodeURIComponent(mock.id)}` as Route}
            className="inline-flex min-h-12 items-center rounded bg-primary px-4 font-semibold text-primary-foreground"
          >
            OPEN MY MOCK
          </Link>
        ) : (
          <Button variant="primary" disabled={disabled || !versionId} onClick={onCheckMock}>
            CHECK &amp; CREATE MOCK
          </Button>
        )}
        <p className="w-full text-sm">MOCK SESSION — NOT LIVE · Portal/staffing writeback OFF</p>
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
            Information still needed before the Real Bid ({realOnly.length})
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
          Final personnel &amp; credential snapshot — September 30, 5:00 PM Eastern cutoff. Reviewed
          updates remain open until then.
        </p>
      )}
    </section>
  );
}
