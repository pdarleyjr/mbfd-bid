'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { z } from 'zod';

const RunsSchema = z.object({
  plan: z.object({
    year: z.number().int(),
    sessions: z.array(
      z.object({
        id: z.string().min(1),
        isMock: z
          .union([z.boolean(), z.literal(0), z.literal(1)])
          .transform((value) => value === true || value === 1),
        currentPhase: z.string().min(1),
      }),
    ),
  }),
});

async function readRealBids(year: number, signal: AbortSignal) {
  const response = await fetch(`/api/admin/annual-plan/${year}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('Your saved Real Bid could not be loaded.');
  const parsed = RunsSchema.safeParse(await response.json());
  if (
    !parsed.success ||
    parsed.data.plan.year !== year ||
    new Set(parsed.data.plan.sessions.map((run) => run.id)).size !==
      parsed.data.plan.sessions.length
  )
    throw new Error('The saved Bid listing does not match this year.');
  return parsed.data.plan.sessions.filter((run) => !run.isMock && run.currentPhase !== 'complete');
}

/** Opening an existing run never creates, starts, resumes or changes it. */
export function RealBidAccess({
  year,
  createdRealId,
  onPrepare,
  disabled = false,
}: {
  year: number;
  createdRealId?: string | null;
  onPrepare?: () => void;
  disabled?: boolean;
}) {
  const runs = useQuery({
    queryKey: ['bid-open-real-runs', year],
    queryFn: ({ signal }) => readRealBids(year, signal),
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });
  const real = createdRealId
    ? [{ id: createdRealId, currentPhase: 'config', isMock: false }]
    : runs.data;
  if (!real && runs.isError)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p role="alert">Could not load your Real Bid.</p>
        <Button type="button" onClick={() => void runs.refetch()} disabled={runs.isFetching}>
          Try again
        </Button>
      </div>
    );
  if (!real) return <output className="text-sm">Loading your Real Bid…</output>;
  if (real.length === 0)
    return onPrepare ? (
      <Button type="button" disabled={disabled} onClick={onPrepare}>
        Prepare Real Bid
      </Button>
    ) : (
      <Link
        href={`/admin/current-bid?year=${year}&view=live` as Route}
        className={buttonVariants()}
      >
        Prepare Real Bid
      </Link>
    );
  return (
    <div aria-label="Your Real Bid" className="flex flex-wrap items-center gap-2">
      {real.map((run, index) => (
        <Link
          key={run.id}
          href={`/admin/bid?session_id=${encodeURIComponent(run.id)}` as Route}
          className={buttonVariants({ variant: 'primary' })}
        >
          {real.length === 1 ? 'Open Real Bid' : `Open Real Bid ${index + 1}`}
        </Link>
      ))}
      <span className="text-sm text-muted-foreground">
        {year} ·{' '}
        {real.length > 1
          ? 'Choose an existing session'
          : real[0]?.currentPhase === 'config'
            ? 'Ready to start'
            : real[0]?.currentPhase === 'paused'
              ? 'Paused · progress saved'
              : 'In progress'}
      </span>
    </div>
  );
}
