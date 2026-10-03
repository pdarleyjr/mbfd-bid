'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { type BidLaunchAcknowledgement, BidLaunchReviewSchema } from '@mbfd/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { BidLaunchAction } from '../../_components/BidLaunchAction';
import { BidLiveReadinessSchema } from '../../current-bid/bid-client';

const previewSchema = z
  .object({
    dry_run: z.literal(true),
    bid_year: z.number().int(),
    is_mock: z.boolean(),
    mode: z.enum(['mock', 'live']),
    would_allow_start: z.boolean(),
    readiness: BidLiveReadinessSchema.nullable(),
    launchReview: BidLaunchReviewSchema,
  })
  .strict();

export function NewSessionForm({ defaultMock = true }: { defaultMock?: boolean }) {
  const router = useRouter();
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [bidYear, setBidYear] = useState(new Date().getFullYear());
  const [isMock, setIsMock] = useState(defaultMock);
  const [error, setError] = useState<string | null>(null);
  const [managed, setManaged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{
    stamp: string;
    data: z.infer<typeof previewSchema>;
  } | null>(null);
  const inFlight = useRef(false);
  const stamp = `${bidYear}:${isMock ? 'mock' : 'live'}`;
  const reviewed = preview?.stamp === stamp ? preview.data : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry token explicitly repeats this read-only preview.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setPreview(null);
    setError(null);
    setManaged(false);
    void (async () => {
      try {
        const response = await csrfFetch('/api/admin/bid-session/readiness-preview', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bid_year: bidYear, mode: isMock ? 'mock' : 'live' }),
        });
        const body: unknown = await response.json();
        const failure = z.object({ error: z.string() }).passthrough().safeParse(body);
        if (failure.success) {
          if (!cancelled) {
            setManaged(failure.data.error === 'managed_bid_version_required');
            setError(
              failure.data.error === 'managed_bid_version_required'
                ? null
                : `Launch check failed: ${failure.data.error.replaceAll('_', ' ')}.`,
            );
          }
          return;
        }
        const next = previewSchema.safeParse(body);
        if (
          !response.ok ||
          !next.success ||
          next.data.bid_year !== bidYear ||
          next.data.is_mock !== isMock ||
          next.data.mode !== (isMock ? 'mock' : 'live') ||
          next.data.would_allow_start !== (next.data.readiness?.canStartLiveBid ?? true)
        )
          throw new Error('The launch review could not be verified. Check again.');
        if (!cancelled) setPreview({ stamp, data: next.data });
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : 'The launch review could not be loaded. Check again.',
          );
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bidYear, isMock, stamp, attempt, csrfFetch]);

  async function createSession(launchAcknowledgement?: BidLaunchAcknowledgement) {
    if (!reviewed?.would_allow_start || checking || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await csrfFetch('/api/admin/bid-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bid_year: bidYear,
          mode: isMock ? 'mock' : 'live',
          ...(launchAcknowledgement ? { launchAcknowledgement } : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string().optional() }).passthrough().safeParse(body);
        const code = failure.success ? failure.data.error : undefined;
        if (code === 'managed_bid_version_required') {
          setManaged(true);
          setPreview(null);
        } else if (code === 'launch_review_changed' || code === 'launch_acknowledgement_required')
          setAttempt((value) => value + 1);
        else
          setError(`Creation failed: ${code?.replaceAll('_', ' ') ?? `HTTP ${response.status}`}.`);
        return;
      }
      const result = z
        .object({ id: z.string().min(1), is_mock: z.boolean(), current_phase: z.literal('config') })
        .passthrough()
        .safeParse(body);
      if (!result.success || result.data.is_mock !== isMock)
        throw new Error(
          'The creation result could not be verified. Check session history before retrying.',
        );
      router.push(`/admin/bid?session_id=${encodeURIComponent(result.data.id)}` as Route);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The creation result could not be verified. Check session history before retrying.',
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <Label className="block">
        Bid year
        <Input
          type="number"
          min={2024}
          max={2100}
          value={bidYear}
          disabled={submitting}
          onChange={(event) => setBidYear(Number(event.target.value))}
          className="mt-1"
        />
      </Label>
      <Label className="block">
        Bid mode
        <select
          value={isMock ? 'mock' : 'live'}
          disabled={submitting}
          onChange={(event) => setIsMock(event.target.value === 'mock')}
          className="mt-1 block min-h-11 w-full rounded border border-border bg-card px-3"
        >
          <option value="mock">Mock Bid</option>
          <option value="live">Real Bid</option>
        </select>
      </Label>
      <p className="text-sm text-muted-foreground">
        Rules, duration and turn timer come from the saved annual configuration.
      </p>
      {managed ? (
        <p className="text-sm">
          This year uses a saved Bid.{' '}
          <Link
            href={`/admin/current-bid?year=${bidYear}` as Route}
            className="inline-flex min-h-11 items-center font-semibold underline"
          >
            Open Current Bid
          </Link>
        </p>
      ) : (
        <BidLaunchAction
          review={reviewed?.launchReview}
          label={
            checking
              ? 'Checking launch…'
              : submitting
                ? 'Creating…'
                : isMock
                  ? 'Create Mock Bid'
                  : 'Create Real Bid'
          }
          advisoryLabel={
            submitting
              ? 'Creating…'
              : isMock
                ? 'Create Mock with advisories'
                : 'Create Real with advisories'
          }
          disabled={checking || submitting || !reviewed?.would_allow_start}
          onLaunch={(acknowledgement) => void createSession(acknowledgement)}
        />
      )}
      {reviewed?.would_allow_start === false && (
        <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
          {reviewed.readiness?.checks
            .filter((check) => reviewed.readiness?.blockingCheckIds.includes(check.id))
            .map((check) => (
              <li key={check.id}>{check.detail ?? check.id.replaceAll('_', ' ')}</li>
            ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!checking && !reviewed && !managed && (
        <Button type="button" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          Check launch again
        </Button>
      )}
    </div>
  );
}
