'use client';

import { Button } from '@/components/ui/button';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';

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

  async function startMock() {
    if (!isMock || inFlight.current || started) return;
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
          body: '{}',
        },
      );
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 401) {
          setError('Sign in again, then select Start Mock Bid. Your saved session is retained.');
        } else if (result.error === 'invalid_state') {
          setError('The session state changed. Refresh this page before starting it.');
        } else {
          setError(`The Mock could not start: ${result.error ?? `HTTP ${response.status}`}.`);
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
      {isMock ? (
        <>
          <Button
            type="button"
            variant="primary"
            className="mt-4 min-h-11"
            disabled={busy || started}
            onClick={() => void startMock()}
          >
            {started ? 'Mock started — opening bid…' : busy ? 'Starting Mock…' : 'Start Mock Bid'}
          </Button>
        </>
      ) : (
        <Link
          href={`/admin/sessions/${encodeURIComponent(bidSessionId)}` as Route}
          className="mt-4 inline-flex min-h-11 items-center font-semibold underline"
        >
          Review and start Real Bid
        </Link>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
