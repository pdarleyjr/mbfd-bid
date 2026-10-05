'use client';

import { Button } from '@/components/ui/button';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sessionId = z.string().min(1).max(100);
const ReviewSchema = z
  .object({
    year: z.number().int(),
    archiveSha256: digest.nullable(),
    available: z.boolean(),
    sessions: z
      .array(
        z
          .object({
            id: sessionId,
            isMock: z.boolean(),
            phase: z.enum(['config', 'position_bid']),
            alreadyApplied: z.boolean(),
            sourceReceiptSha256: digest.nullable(),
            expectedSnapshotSha256: digest,
            expectedVersionSha256: digest,
            expectedCanonicalSeq: z
              .number()
              .int()
              .nonnegative()
              .max(Number.MAX_SAFE_INTEGER)
              .nullable(),
            expectedCanonicalStateSha256: digest.nullable(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .refine(
    (review) =>
      (!review.available || review.archiveSha256 !== null) &&
      new Set(review.sessions.map((session) => session.id)).size === review.sessions.length &&
      review.sessions.every(
        (session) => !session.alreadyApplied || session.sourceReceiptSha256 !== null,
      ) &&
      review.sessions.every((session) =>
        session.phase === 'config'
          ? session.expectedCanonicalSeq === null && session.expectedCanonicalStateSha256 === null
          : session.expectedCanonicalSeq !== null && session.expectedCanonicalStateSha256 !== null,
      ),
  );
type Review = z.infer<typeof ReviewSchema>;
const ReceiptSchema = z
  .object({
    sessionId,
    archiveSha256: digest,
    receiptSha256: digest,
    memberCount: z.number().int().nonnegative(),
    referenceCount: z.number().int().nonnegative(),
    alreadyApplied: z.boolean(),
    activeCheckpoint: z
      .object({
        canonicalSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        canonicalStateSha256: digest,
        phase: z.literal('position_bid'),
      })
      .strict()
      .optional(),
  })
  .strict();
type ReviewState = { year: number; data: Review | null; loading: boolean; error: string | null };

export function BidRankSourceReview({ year }: { year: number }) {
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentYear = useRef(year);
  currentYear.current = year;
  const generation = useRef(0);
  const busyRef = useRef(false);
  const reviewReadyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mutationFetch = useRef<ReturnType<typeof createCsrfAwareFetch> | null>(null);

  useEffect(() => {
    void year;
    generation.current++;
    busyRef.current = false;
    reviewReadyRef.current = false;
    controllerRef.current?.abort();
    setSelectedSessionId('');
    setBusy(false);
    setRequiresReload(false);
    setError(null);
    setNotice(null);
    return () => {
      generation.current++;
      controllerRef.current?.abort();
    };
  }, [year]);

  useEffect(() => {
    void reload;
    if (!open || busyRef.current) return;
    reviewReadyRef.current = false;
    const controller = new AbortController();
    const operationGeneration = generation.current;
    const stillCurrent = () =>
      !controller.signal.aborted &&
      currentYear.current === year &&
      generation.current === operationGeneration;
    setReview({ year, data: null, loading: true, error: null });
    void fetch(`/api/admin/bid-forms/${year}/score-review`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Final priorities could not be loaded. Reload priorities to try again.');
        const result = ReviewSchema.safeParse(await response.json());
        if (!result.success || result.data.year !== year)
          throw new Error(
            'The priority review could not be verified. Reload priorities before applying.',
          );
        return result.data;
      })
      .then((data) => {
        if (!stillCurrent()) return;
        const realSessions = data.sessions.filter((session) => !session.isMock);
        setReview({ year, data: { ...data, sessions: realSessions }, loading: false, error: null });
        setSelectedSessionId((previous) =>
          realSessions.some((session) => session.id === previous)
            ? previous
            : realSessions.length === 1
              ? (realSessions[0]?.id ?? '')
              : '',
        );
        reviewReadyRef.current = true;
        setRequiresReload(false);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!stillCurrent()) return;
        setReview({
          year,
          data: null,
          loading: false,
          error: caught instanceof Error ? caught.message : 'Final priorities could not be loaded.',
        });
      });
    return () => controller.abort();
  }, [open, year, reload]);

  const current = review?.year === year ? review : null;
  const session = current?.data?.sessions.find((entry) => entry.id === selectedSessionId) ?? null;

  async function apply() {
    const saved = current?.data;
    const selected = session;
    if (
      busyRef.current ||
      !reviewReadyRef.current ||
      !open ||
      !saved?.available ||
      !saved.archiveSha256 ||
      !selected ||
      selected.alreadyApplied ||
      requiresReload ||
      current?.loading
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    const operationGeneration = generation.current;
    const stillCurrent = () =>
      !controller.signal.aborted &&
      currentYear.current === year &&
      generation.current === operationGeneration;
    try {
      mutationFetch.current ??= createCsrfAwareFetch(
        (input, init) => window.fetch(input, init),
        () => window.location.origin,
      );
      const response = await mutationFetch.current(
        `/api/admin/bid-forms/${year}/sessions/${encodeURIComponent(selected.id)}/score-reference`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            archiveSha256: saved.archiveSha256,
            expectedSnapshotSha256: selected.expectedSnapshotSha256,
            expectedVersionSha256: selected.expectedVersionSha256,
            ...(selected.phase === 'position_bid'
              ? {
                  expectedCanonicalSeq: selected.expectedCanonicalSeq,
                  expectedCanonicalStateSha256: selected.expectedCanonicalStateSha256,
                }
              : {}),
          }),
        },
      );
      if (response.status === 409) {
        if (stillCurrent()) {
          reviewReadyRef.current = false;
          setReview({ year, data: null, loading: false, error: null });
        }
        throw new Error('The source or bid changed. Reload priorities before applying again.');
      }
      if (!response.ok)
        throw new Error(
          'Final priorities were not confirmed. Reload priorities before trying again.',
        );
      const result = ReceiptSchema.safeParse(await response.json());
      if (
        !result.success ||
        result.data.sessionId !== selected.id ||
        result.data.archiveSha256 !== saved.archiveSha256 ||
        (selected.phase === 'position_bid'
          ? result.data.activeCheckpoint?.canonicalSeq !== selected.expectedCanonicalSeq ||
            result.data.activeCheckpoint?.canonicalStateSha256 !==
              selected.expectedCanonicalStateSha256
          : result.data.activeCheckpoint !== undefined)
      )
        throw new Error(
          'The priority receipt could not be verified. Reload priorities before trying again.',
        );
      if (!stillCurrent()) return;
      setReview({
        year,
        loading: false,
        error: null,
        data: {
          ...saved,
          sessions: saved.sessions.map((entry) =>
            entry.id === selected.id
              ? { ...entry, alreadyApplied: true, sourceReceiptSha256: result.data.receiptSha256 }
              : entry,
          ),
        },
      });
      setNotice(
        result.data.alreadyApplied
          ? 'Final priorities were already applied.'
          : selected.phase === 'position_bid'
            ? 'Remaining-pick priorities updated. Recorded selections are preserved.'
            : `Final priorities applied · ${result.data.memberCount} members · ${result.data.referenceCount} references.`,
      );
    } catch (caught: unknown) {
      if (!stillCurrent()) return;
      reviewReadyRef.current = false;
      setRequiresReload(true);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Final priorities could not be verified. Reload priorities before trying again.',
      );
    } finally {
      if (stillCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <details
      className="border-t border-border pt-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
        Use final specialty priorities
      </summary>
      {open ? (
        <div className="space-y-3 py-3 text-sm">
          <p className="text-muted-foreground">
            {session?.phase === 'position_bid'
              ? 'Updates remaining picks from the final lists. Recorded selections stay unchanged.'
              : 'Uses the published rank lists for priority. Certification requirements and selections stay unchanged.'}
          </p>
          {current?.loading ? <output>Loading final priorities…</output> : null}
          {current?.data ? (
            !current.data.available ? (
              <p>Publish the final rank lists first.</p>
            ) : current.data.sessions.length === 0 ? (
              <p>No prepared or active Real Bid is available for this update.</p>
            ) : (
              <>
                {current.data.sessions.length === 1 ? (
                  <p>
                    {session?.phase === 'position_bid' ? 'Active Real Bid' : 'Prepared Real Bid'}
                  </p>
                ) : (
                  <label className="block space-y-2">
                    <span className="block font-semibold">Real Bid</span>
                    <select
                      value={selectedSessionId}
                      disabled={busy}
                      onChange={(event) => {
                        setSelectedSessionId(event.currentTarget.value);
                        setNotice(null);
                      }}
                      className="block min-h-11 w-full rounded border border-input bg-background px-3"
                    >
                      <option value="">Choose a bid</option>
                      {current.data.sessions.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.phase === 'position_bid' ? 'Active' : 'Prepared'} · {entry.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {session ? (
                  <a
                    className="break-all text-info underline"
                    href={`/admin/bid?session_id=${encodeURIComponent(session.id)}`}
                  >
                    Open this Real Bid
                  </a>
                ) : null}
                {session?.alreadyApplied ? (
                  <output className="block">Final priorities already applied.</output>
                ) : null}
                {session?.phase === 'position_bid' ? (
                  <p className="text-muted-foreground">
                    Bid checkpoint {session.expectedCanonicalSeq}
                  </p>
                ) : null}
              </>
            )
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || current?.loading}
            onClick={() => {
              reviewReadyRef.current = false;
              setRequiresReload(true);
              setNotice(null);
              setReload((value) => value + 1);
            }}
          >
            Reload priorities
          </Button>
          {error || current?.error ? (
            <p role="alert" className="text-warning">
              {error ?? current?.error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={
              busy ||
              current?.loading ||
              !current?.data?.available ||
              !session ||
              session.alreadyApplied ||
              requiresReload
            }
            onClick={() => void apply()}
          >
            {busy
              ? 'Applying priorities…'
              : session?.phase === 'position_bid'
                ? 'Update remaining picks'
                : 'Apply final priorities'}
          </Button>
          {notice ? <output className="block text-success">{notice}</output> : null}
        </div>
      ) : null}
    </details>
  );
}
