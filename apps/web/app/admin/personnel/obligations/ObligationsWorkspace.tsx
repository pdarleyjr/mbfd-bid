'use client';
import { RetainedEvidenceReview } from '@/components/admin/RetainedEvidenceReview';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import type { PostAwardObligation } from '@mbfd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  annualGet,
  annualPost,
  buttonClass,
  fieldClass,
} from '../../annual-plan/annual-plan-client';
type Review = {
  id: string;
  revision: number;
  effectiveOn: string;
  status: string;
  completedOn: string | null;
  sourceRef: string;
  reason: string;
  actorSubject: string;
};
type Obligation = {
  term: PostAwardObligation;
  positionId: string;
  memberId: number;
  memberName: string | null;
  finalBidId: string;
  dueOn: string | null;
  status: string;
  completionTiming: string | null;
  latestRevision: number;
  award: { eventId: string; awardedAtMs: number } | null;
  history: Review[];
};
type Projection = { completion: { revision: number }; obligations: Obligation[] };
export function ObligationsWorkspace() {
  const client = useQueryClient();
  const [session, setSession] = useState('');
  const [asOf, setAsOf] = useState('');
  const [selected, setSelected] = useState<{ row: Obligation; completionSeq: number } | null>(null);
  const [effective, setEffective] = useState('');
  const [status, setStatus] = useState('');
  const [completed, setCompleted] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  useUnsavedChanges(!!selected, 'post-award review');
  const sources = useQuery({
    queryKey: ['admin', 'annual-plan', 'official-sources'],
    staleTime: 30_000,
    queryFn: () =>
      annualGet<{ sources: { sessionId: string; year: number }[] }>('annual-plan/official-sources'),
  });
  const projection = useQuery({
    queryKey: ['admin', 'post-award-obligations', session, asOf],
    enabled: !!session && !!asOf,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () =>
      annualGet<Projection>(`post-award-obligations/${encodeURIComponent(session)}?as_of=${asOf}`),
  });
  function clear() {
    setSelected(null);
    setEffective('');
    setStatus('');
    setCompleted('');
    setSource('');
    setReason('');
    pending.current = null;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage('');
    const body = {
      final_bid_id: selected.row.finalBidId,
      obligation_id: selected.row.term.id,
      expected_revision: selected.row.latestRevision,
      expected_completion_seq: selected.completionSeq,
      effective_on: effective,
      status,
      completed_on: status === 'COMPLETED' ? completed : null,
      source_ref: source,
      reason,
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost(
        `post-award-obligations/${encodeURIComponent(session)}/reviews`,
        body,
        pending.current.key,
      );
      clear();
      await client.invalidateQueries({ queryKey: ['admin', 'post-award-obligations'] });
      setMessage(
        'Review recorded. Qualification evidence and assignment records remain available in their own workspaces.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Review could not be saved');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5 text-slate-100">
      <header>
        <h1 className="font-heading text-3xl">Post-award Qualifications</h1>
        <p className="mt-2 text-sm text-slate-300">
          Track follow-up requirements from a verified completed bid. Deadlines use that session’s
          frozen terms and the final accepted award event. A past-due label calls for review; it
          does not remove an assignment or impose discipline.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Official completed bid
          <select
            className={fieldClass}
            value={session}
            disabled={!!selected || busy}
            onChange={(e) => setSession(e.target.value)}
          >
            <option value="">Choose official bid</option>
            {sources.data?.sources.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.year} · {s.sessionId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Review as of
          <input
            type="date"
            className={fieldClass}
            value={asOf}
            disabled={!!selected || busy}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
      </div>
      {sources.data?.sources.length === 0 && <p>No verified official completion is available.</p>}
      {(sources.isError || projection.isError) && (
        <p role="alert" className="text-amber-200">
          {projection.error instanceof Error
            ? projection.error.message
            : 'Official source list could not be refreshed'}
          . Saved form edits are retained.
        </p>
      )}
      <Link
        className="inline-flex min-h-11 items-center text-sky-300 underline"
        href={'/admin/personnel/qualifications' as Route}
      >
        Qualification evidence
      </Link>
      {selected && (
        <form onSubmit={save} className="rounded border border-sky-600 bg-slate-900 p-4">
          <fieldset disabled={busy} className="space-y-4">
            <legend className="px-1 font-semibold">
              Review {selected.row.term.credential} ·{' '}
              {selected.row.memberName ?? `Member ${selected.row.memberId}`}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                Review effective date
                <input
                  required
                  type="date"
                  className={fieldClass}
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                />
              </label>
              <label>
                Reviewed status
                <select
                  required
                  className={fieldClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Choose status</option>
                  <option value="COMPLETED">Completion verified</option>
                  <option value="PENDING">Pending</option>
                  <option value="UNKNOWN">Unknown — needs evidence</option>
                </select>
              </label>
            </div>
            {status === 'COMPLETED' && (
              <label className="block">
                Verified completion date
                <input
                  required
                  type="date"
                  max={effective || undefined}
                  className={fieldClass}
                  value={completed}
                  onChange={(e) => setCompleted(e.target.value)}
                />
              </label>
            )}
            <label className="block">
              Evidence reference
              <input
                required
                minLength={4}
                maxLength={500}
                className={fieldClass}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <label className="block">
              Review reason
              <input
                required
                minLength={4}
                maxLength={500}
                className={fieldClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="submit" className={buttonClass}>
                {busy ? 'Saving…' : 'Record review'}
              </button>
              <button type="button" className={buttonClass} onClick={clear}>
                Discard review edits
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {selected && (
        <RetainedEvidenceReview
          key={`${session}:${selected.row.finalBidId}:${selected.row.term.id}`}
          disabled={busy}
          load={async () => {
            const fresh = await projection.refetch();
            if (fresh.error || !fresh.data)
              throw new Error('Post-award evidence could not be refreshed');
            const row = fresh.data.obligations.find(
              (r) =>
                r.finalBidId === selected.row.finalBidId &&
                r.term.id === selected.row.term.id &&
                r.memberId === selected.row.memberId &&
                r.positionId === selected.row.positionId,
            );
            if (!row?.award)
              throw new Error(
                'The selected final award is no longer comparable. Review the updated awards before starting a new review. Your edits remain available.',
              );
            return {
              value: { row, completionSeq: fresh.data.completion.revision },
              label: `Evidence revision ${row.latestRevision}; completion revision ${fresh.data.completion.revision}`,
            };
          }}
          useRevision={(value) => {
            setSelected(value);
            pending.current = null;
          }}
        />
      )}
      {message && <output className="block rounded border border-slate-600 p-3">{message}</output>}
      <div className="grid gap-4 lg:grid-cols-2">
        {projection.data?.obligations.map((row) => (
          <article
            key={`${row.finalBidId}:${row.term.id}`}
            className="min-w-0 space-y-3 rounded border border-slate-700 bg-slate-900 p-4"
          >
            <h2 className="font-heading text-xl">
              {row.memberName ?? `Member ${row.memberId}`} · {row.term.credential}
            </h2>
            <p className="break-words text-sm text-slate-300">
              Position {row.positionId} · Final award {row.finalBidId}
            </p>
            <p className="font-semibold">
              {row.status.replaceAll('_', ' ')}
              {row.completionTiming ? ` · ${row.completionTiming.replaceAll('_', ' ')}` : ''}
            </p>
            <p>
              Due {row.dueOn ?? 'unknown — award evidence required'} · {row.term.deadline.count}{' '}
              {row.term.deadline.unit.toLowerCase().replaceAll('_', ' ')} ·{' '}
              {row.term.deadline.timeZone}
            </p>
            <p className="text-sm text-slate-300">
              {row.term.deadline.basis === 'APPROVED_BID_START_DATE'
                ? `Measured from approved bid start ${row.term.deadline.startOn}; retained through award amendments.`
                : 'Measured from the final accepted position award, including its replacement after an amendment.'}
            </p>
            <p className="break-words text-sm">Policy source: {row.term.sourceRef}</p>
            {row.award && (
              <p className="break-words text-xs text-slate-400">
                Award event {row.award.eventId} · {new Date(row.award.awardedAtMs).toISOString()}
              </p>
            )}
            <button
              className={buttonClass}
              type="button"
              disabled={!!selected || !row.award || projection.isError}
              onClick={() => {
                if (projection.data)
                  setSelected({ row, completionSeq: projection.data.completion.revision });
              }}
            >
              Review evidence
            </button>
            <details>
              <summary className="cursor-pointer text-sm">
                Review history ({row.history.length})
              </summary>
              <div className="mt-2 space-y-3">
                {row.history.map((r) => (
                  <div key={r.id} className="border-t border-slate-700 pt-2 text-sm">
                    <p>
                      Revision {r.revision} · {r.effectiveOn} · {r.status}
                      {r.completedOn ? ` · Completed ${r.completedOn}` : ''}
                    </p>
                    <p className="break-words">{r.sourceRef}</p>
                    <p>
                      {r.reason} · Reviewed by {r.actorSubject}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>
      {projection.data?.obligations.length === 0 && (
        <p>This frozen session has no post-award terms configured for its final awarded seats.</p>
      )}
    </div>
  );
}
