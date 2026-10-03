'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useMemo, useRef, useState } from 'react';

type Review = { valid: true; expectedSeq: number; warnings: { code: string; message: string }[] };

/** All policy exceptions use the same server preview and exact reviewed command. */
export function ReviewedBidAdjustment({
  sessionId,
  sequence,
  detail,
  reason,
  disabled,
  label,
  onSaved,
}: {
  sessionId: string;
  sequence: number;
  detail: Record<string, unknown>;
  reason: string;
  disabled: boolean;
  label: string;
  onSaved(): void;
}) {
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [review, setReview] = useState<{ fingerprint: string; result: Review } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const inFlight = useRef(false);
  const body = {
    v: 1,
    ...detail,
    expectedSeq: sequence,
    reason: reason.trim(),
    evidenceReference: null,
    adminOverride: { acknowledged: true, warningCodes: [] as string[] },
  };
  const fingerprint = JSON.stringify([sessionId, body]);
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const reviewed = review?.fingerprint === fingerprint ? review.result : null;
  const blocked = disabled || busy || reason.trim().length < 4;

  async function preview() {
    if (blocked || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setAcknowledged(false);
    setReview(null);
    setNotice(null);
    const submitted = fingerprint;
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${encodeURIComponent(sessionId)}/commands/live/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, commandId: crypto.randomUUID() }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | (Review & { code?: string; error?: string })
        | null;
      if (current.current !== submitted) return;
      if (
        !response.ok ||
        result?.valid !== true ||
        result.expectedSeq !== sequence ||
        !Array.isArray(result.warnings) ||
        result.warnings.some(
          (warning) => typeof warning.code !== 'string' || typeof warning.message !== 'string',
        )
      )
        throw new Error(
          result?.code ?? result?.error ?? 'Preview unavailable. Refresh and review again.',
        );
      setReview({ fingerprint: submitted, result });
    } catch (error) {
      if (current.current === submitted)
        setNotice(error instanceof Error ? error.message : 'Preview unavailable.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function confirm() {
    if (blocked || inFlight.current || !reviewed || !acknowledged) return;
    const submitted = fingerprint;
    if (pending.current?.fingerprint !== submitted)
      pending.current = { fingerprint: submitted, commandId: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${encodeURIComponent(sessionId)}/commands/live`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            commandId: pending.current.commandId,
            adminOverride: {
              acknowledged: true,
              warningCodes: reviewed.warnings.map((warning) => warning.code),
            },
          }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        kind?: string;
        code?: string;
        error?: string;
      } | null;
      if (!response.ok || result?.kind !== 'accepted') {
        if (result?.kind === 'rejected') {
          pending.current = null;
          setReview(null);
          setAcknowledged(false);
        }
        throw new Error(
          result?.code ??
            result?.error ??
            'Delivery uncertain. Confirm again to safely retry the same action.',
        );
      }
      pending.current = null;
      setReview(null);
      setAcknowledged(false);
      setNotice('Adjustment saved.');
      onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Adjustment unavailable.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <Button type="button" disabled={blocked} onClick={() => void preview()}>
        {busy ? 'Checking…' : `Review ${label.toLowerCase()}`}
      </Button>
      {review && !reviewed ? (
        <p role="alert" className="text-sm text-warning">
          The bid changed. Review again.
        </p>
      ) : null}
      {reviewed ? (
        <section
          aria-label={`${label} review`}
          className="space-y-2 border-t border-border pt-2 text-sm"
        >
          {reviewed.warnings.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {reviewed.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          ) : (
            <p>No policy deviations.</p>
          )}
          <Label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              aria-label={`I reviewed ${label.toLowerCase()}`}
              checked={acknowledged}
              disabled={blocked}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I reviewed the adjustment and advisories.
          </Label>
          <Button type="button" disabled={blocked || !acknowledged} onClick={() => void confirm()}>
            Confirm {label.toLowerCase()}
          </Button>
        </section>
      ) : null}
      {notice ? <output className="block text-sm">{notice}</output> : null}
    </div>
  );
}
