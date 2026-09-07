'use client';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  type AnnualPlan,
  annualGet,
  annualPost,
  buttonClass,
  expectedPlan,
  fieldClass,
} from './annual-plan-client';
export function AnnualPlanFreeze({
  plan,
  onDirty,
  onSaved,
}: { plan: AnnualPlan; onDirty(v: boolean): void; onSaved(): Promise<void> }) {
  const sessions = useQuery({
    queryKey: ['admin', 'annual-plan', plan.year, 'mock-sessions'],
    queryFn: () =>
      annualGet<{
        sessions: { id: string; bidYear: number; currentPhase: string; isMock: boolean }[];
      }>('rehearsal/sessions'),
    staleTime: 30_000,
  });
  const [session, setSession] = useState('');
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const revision = useRef<ReturnType<typeof expectedPlan> | null>(null);
  const mockPending = useRef<{
    key: string;
    body: ReturnType<typeof expectedPlan> & { bid_year: number; mode: 'mock' };
  } | null>(null);
  const [createdMock, setCreatedMock] = useState('');
  const [mockConflict, setMockConflict] = useState(false);
  useUnsavedChanges(
    !!(session || reason || accepted || mockPending.current),
    'annual freeze review',
  );
  async function createMock() {
    setBusy(true);
    setMessage('');
    setMockConflict(false);
    onDirty(true);
    if (!mockPending.current)
      mockPending.current = {
        key: crypto.randomUUID(),
        body: { ...expectedPlan(plan), bid_year: plan.year, mode: 'mock' },
      };
    try {
      const result = await annualPost<{ id: string }>(
        'bid-session',
        mockPending.current.body,
        mockPending.current.key,
      );
      setCreatedMock(result.id);
      mockPending.current = null;
      await sessions.refetch();
      await onSaved();
      setMessage(
        'Mock created with the reviewed configuration. Open the Rehearsal Console to run it; creation is not a completed rehearsal.',
      );
    } catch (e) {
      const detail =
        e instanceof Error ? e.message : 'Mock response unavailable. Retry the same request.';
      setMessage(detail);
      setMockConflict(detail.includes('bid configuration changed'));
    } finally {
      setBusy(false);
    }
  }
  function edit() {
    if (!revision.current) revision.current = expectedPlan(plan);
    onDirty(true);
  }
  async function freeze(event: React.FormEvent) {
    event.preventDefault();
    if (!revision.current) return;
    setBusy(true);
    setMessage('');
    const body = { ...revision.current, mock_session_id: session, reason, accept_review: accepted };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost(`annual-plan/${plan.year}/freeze`, body, pending.current.key);
      setSession('');
      setReason('');
      setAccepted(false);
      revision.current = null;
      pending.current = null;
      await onSaved();
      setMessage('The designated rule book and annual policy are frozen.');
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Freeze failed. Retry retains the same request key.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-slate-300">
        Complete a Mock rehearsal against this exact configuration, resolve its findings, then
        review the results. Freezing publishes the designated rules and operating policy together.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={
            busy || mockConflict || plan.lifecycle !== 'DRAFT' || !!(session || reason || accepted)
          }
          onClick={createMock}
        >
          {mockPending.current
            ? 'Retry same Mock creation request'
            : createdMock
              ? 'Create another Mock from current plan'
              : 'Create Mock from reviewed configuration'}
        </button>
        <Link className={buttonClass} href={'/admin/rehearsal' as Route}>
          Rehearsal Console and findings
        </Link>
      </div>
      {createdMock && (
        <p className="break-all text-sm">
          Created Mock: {createdMock}. Choose this session in the Rehearsal Console.
        </p>
      )}
      {mockConflict && (
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={async () => {
            try {
              const fresh = await annualGet<{ plan: AnnualPlan }>(`annual-plan/${plan.year}`);
              mockPending.current = {
                key: crypto.randomUUID(),
                body: { ...expectedPlan(fresh.plan), bid_year: plan.year, mode: 'mock' },
              };
              setMockConflict(false);
              setMessage(
                `Review refreshed configuration revision ${fresh.plan.configurationRevision}, rule revision ${fresh.plan.ruleBookRevision} and source revision ${fresh.plan.sourceRevision}. Submit the new Mock request when ready.`,
              );
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Latest plan unavailable');
            }
          }}
        >
          Review latest configuration for a new Mock request
        </button>
      )}
      {sessions.isError && <p role="alert">Mock sessions could not be refreshed.</p>}
      <form onSubmit={freeze} onChange={edit} className="space-y-4">
        <fieldset
          disabled={busy || !!mockPending.current || plan.lifecycle !== 'DRAFT'}
          className="space-y-4"
        >
          <label className="block">
            Completed Mock rehearsal
            <select
              required
              className={fieldClass}
              value={session}
              onChange={(e) => setSession(e.target.value)}
            >
              <option value="">Choose a completed Mock</option>
              {sessions.data?.sessions
                .filter((s) => s.isMock && s.bidYear === plan.year && s.currentPhase === 'complete')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.bidYear} · {s.id}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-sm text-slate-400">
            The server verifies the completion receipt and compares the Mock’s frozen rules,
            participants, qualifications and operating policy with this plan.
          </p>
          <label className="block">
            Review findings and reason for freezing
            <textarea
              required
              minLength={4}
              maxLength={500}
              className={fieldClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              required
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I reviewed the changes, eligibility impact and completed rehearsal findings for this
            plan.
          </label>
          <button type="submit" disabled={!accepted || !session || busy} className={buttonClass}>
            {busy ? 'Verifying and freezing…' : 'Freeze reviewed annual plan'}
          </button>
        </fieldset>
      </form>
      {message && (
        <output className="block whitespace-pre-wrap rounded border border-slate-600 p-3">
          {message}
        </output>
      )}
    </div>
  );
}
