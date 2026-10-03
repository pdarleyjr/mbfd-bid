'use client';

import { Button } from '@/components/ui/button';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { type BidLaunchAcknowledgement, BidLaunchReviewSchema } from '@mbfd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { BidLaunchAction } from '../../_components/BidLaunchAction';
import { BidLiveReadinessSchema } from '../../current-bid/bid-client';

const setupReviewSchema = z
  .object({
    id: z.string().min(1),
    is_mock: z.boolean(),
    readiness: BidLiveReadinessSchema.nullable(),
    launchReview: BidLaunchReviewSchema.optional(),
    launchAcknowledged: z.boolean().optional(),
  })
  .strict();

type SetupReview = z.infer<typeof setupReviewSchema>;

/** CONFIG is a saved session awaiting Start, not an unfrozen legacy operator console. */
export function BidSessionSetup({
  bidSessionId,
  isMock,
  memberCount,
  onStarted,
}: {
  bidSessionId: string;
  isMock: boolean;
  memberCount: number;
  onStarted(): void;
}) {
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<SetupReview | null>(null);
  const [checking, setChecking] = useState(true);
  const [reviewAttempt, setReviewAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry token explicitly repeats this read-only check.
  useEffect(() => {
    let cancelled = false;
    setReview(null);
    setChecking(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/bid-session/${encodeURIComponent(bidSessionId)}/readiness`,
          { credentials: 'include', cache: 'no-store' },
        );
        const body: unknown = await response.json();
        if (!response.ok) {
          const result = z.object({ error: z.string().optional() }).passthrough().safeParse(body);
          throw new Error(
            response.status === 401
              ? 'Refresh operator sign-in, then check again. Your saved session is retained.'
              : `Launch check failed: ${result.success ? (result.data.error ?? `HTTP ${response.status}`) : `HTTP ${response.status}`}.`,
          );
        }
        const result = setupReviewSchema.safeParse(body);
        if (!result.success || result.data.id !== bidSessionId || result.data.is_mock !== isMock)
          throw new Error('The launch review could not be verified. Check again before starting.');
        if (!cancelled) setReview(result.data);
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
  }, [bidSessionId, isMock, reviewAttempt]);

  async function startBid(acknowledgement?: BidLaunchAcknowledgement) {
    if (inFlight.current || started || !review || checking) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${encodeURIComponent(bidSessionId)}/start`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(acknowledgement ||
            (review.launchAcknowledged && review.launchReview?.requiresAcknowledgement)
              ? {
                  launchAcknowledgement: acknowledgement ?? {
                    advisorySha256: review.launchReview?.advisorySha256,
                  },
                }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          launchReview?: unknown;
        };
        if (response.status === 401) {
          setError('Refresh operator sign-in, then start again. Your saved session is retained.');
        } else if (result.error === 'invalid_state') {
          setError('The session state changed. Refresh this page before starting it.');
        } else if (
          result.error === 'launch_acknowledgement_required' ||
          result.error === 'launch_review_changed'
        ) {
          const next = BidLaunchReviewSchema.safeParse(result.launchReview);
          if (next.success) {
            setReview({ ...review, launchReview: next.data, launchAcknowledged: false });
            setError('The launch advisories changed. Review them, then start with advisories.');
          } else {
            setReview(null);
            setError('The updated launch review could not be verified. Check again.');
          }
        } else {
          setError(`The bid could not start: ${result.error ?? `HTTP ${response.status}`}.`);
        }
        return;
      }
      setStarted(true);
      onStarted();
    } catch {
      setError('The start result could not be verified. Refresh this page before trying again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Bid session setup"
      data-testid="bid-session-setup"
      className="rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {isMock ? 'Mock Bid' : 'Real Bid'} · Not started
      </p>
      <h1 className="mt-1 font-heading text-xl">
        {isMock ? 'Start your Mock Bid' : 'Start your Real Bid'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {memberCount} members · saved rules retained. Start to open position selection.
      </p>
      <div className="mt-4">
        <BidLaunchAction
          review={review?.launchReview}
          acknowledged={review?.launchAcknowledged}
          disabled={
            checking || !review || busy || started || review.readiness?.canStartLiveBid === false
          }
          label={
            started
              ? 'Bid started — opening…'
              : busy
                ? 'Starting…'
                : checking
                  ? 'Checking launch…'
                  : isMock
                    ? 'Start Mock Bid'
                    : 'Start Real Bid'
          }
          advisoryLabel={
            busy ? 'Starting…' : started ? 'Bid started — opening…' : 'Start with advisories'
          }
          onLaunch={(acknowledgement) => void startBid(acknowledgement)}
        />
      </div>
      {review?.readiness?.canStartLiveBid === false && (
        <ul role="alert" className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive">
          {review.readiness.checks
            .filter((check) => review.readiness?.blockingCheckIds.includes(check.id))
            .map((check) => (
              <li key={check.id}>{check.detail ?? check.id.replaceAll('_', ' ')}</li>
            ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!checking && !review && (
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => setReviewAttempt((value) => value + 1)}
        >
          Check launch again
        </Button>
      )}
    </section>
  );
}
