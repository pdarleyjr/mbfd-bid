'use client';
import { RetainedEvidenceReview } from '@/components/admin/RetainedEvidenceReview';
import { invalidateWorkingBidBoards } from '@/lib/admin-projection-refresh';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  annualGet,
  annualPost,
  buttonClass,
  fieldClass,
} from '../../annual-plan/annual-plan-client';
type TenureRecord = {
  id: string;
  revision: number;
  effectiveOn: string;
  status: string;
  memberId: number | null;
  protectedFrom: string | null;
  protectedThrough: string | null;
  sourceRef: string;
  reason: string;
  actorSubject: string;
};
export function TenureWorkspace() {
  const client = useQueryClient();
  const [asOf, setAsOf] = useState('');
  const [seat, setSeat] = useState('');
  const [effective, setEffective] = useState('');
  const [status, setStatus] = useState('');
  const [member, setMember] = useState('');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const expected = useRef<number | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const dirty = !!(effective || status || member || from || through || source || reason);
  useUnsavedChanges(dirty, 'tenure evidence');
  const seats = useQuery({
    queryKey: ['admin', 'current-roster', asOf],
    enabled: !!asOf,
    staleTime: 30_000,
    queryFn: () =>
      annualGet<{ positions: { id: string; stableSlotKey: string }[] }>(
        `current-roster?as_of=${asOf}`,
      ),
  });
  const history = useQuery({
    queryKey: ['admin', 'tenure', 'history', seat],
    enabled: !!seat,
    staleTime: 30_000,
    queryFn: () =>
      annualGet<{ records: TenureRecord[] }>(`tenure-evidence/history/${encodeURIComponent(seat)}`),
  });
  const members = useQuery({
    queryKey: ['admin', 'service-evidence', 'member-options'],
    staleTime: 30_000,
    queryFn: async () => {
      const rows: { id: number; employeeId: string; firstName: string; lastName: string }[] = [];
      let total = 1;
      while (rows.length < total) {
        const page = await annualGet<{ members: typeof rows; total: number }>(
          `members?limit=100&offset=${rows.length}`,
        );
        if (!page.members.length && rows.length < page.total)
          throw new Error('Member list incomplete');
        rows.push(...page.members);
        total = page.total;
      }
      return rows;
    },
  });
  function edit() {
    if (expected.current === null && history.data)
      expected.current = Math.max(0, ...history.data.records.map((r) => r.revision));
  }
  function clear() {
    setEffective('');
    setStatus('');
    setMember('');
    setFrom('');
    setThrough('');
    setSource('');
    setReason('');
    expected.current = null;
    pending.current = null;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (expected.current === null) return;
    setBusy(true);
    setMessage('');
    const body = {
      staffing_position_id: seat,
      expected_revision: expected.current,
      effective_on: effective,
      status,
      member_id: status === 'PROTECTED' ? Number(member) : null,
      protected_from: status === 'PROTECTED' ? from : null,
      protected_through: status === 'PROTECTED' ? through : null,
      source_ref: source,
      reason,
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost('tenure-evidence', body, pending.current.key);
      clear();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'tenure'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
        invalidateWorkingBidBoards(client, ['upcoming']),
      ]);
      setMessage(
        'Reviewed tenure evidence recorded. Review annual participation before preparing a session.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Tenure save failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-5 text-slate-100">
      <header>
        <h1 className="font-heading text-3xl">Tenure and Protection</h1>
        <p className="mt-2 text-sm text-slate-300">
          Record the reviewed member and exact inclusive term dates. An active protected term
          requires a non-biddable annual seat and a matching dated assignment. Unknown status
          requires review. Recording evidence does not change an assignment.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Staffing date
          <input
            type="date"
            className={fieldClass}
            value={asOf}
            disabled={dirty || busy}
            onChange={(e) => {
              setAsOf(e.target.value);
              setSeat('');
              expected.current = null;
            }}
          />
        </label>
        <label>
          Authorized staffing seat
          <select
            className={fieldClass}
            value={seat}
            disabled={!asOf || seats.isPending || seats.isError || dirty || busy}
            onChange={(e) => {
              setSeat(e.target.value);
              expected.current = null;
            }}
          >
            <option value="">Choose seat</option>
            {seats.data?.positions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.stableSlotKey}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(seats.isError || history.isError || members.isError) && (
        <p role="alert" className="text-amber-200">
          Reference data could not be refreshed. Your edits remain in the form.
        </p>
      )}
      <form onSubmit={save}>
        <fieldset
          disabled={
            !seat ||
            history.isPending ||
            history.isError ||
            members.isPending ||
            members.isError ||
            busy
          }
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              Evidence effective date
              <input
                required
                type="date"
                className={fieldClass}
                value={effective}
                onChange={(e) => {
                  edit();
                  setEffective(e.target.value);
                }}
              />
            </label>
            <label>
              Reviewed status
              <select
                required
                className={fieldClass}
                value={status}
                onChange={(e) => {
                  edit();
                  setStatus(e.target.value);
                }}
              >
                <option value="">Choose status</option>
                <option value="PROTECTED">Protected term</option>
                <option value="UNPROTECTED">Reviewed — no protected term</option>
                <option value="UNKNOWN">Unknown — requires review</option>
              </select>
            </label>
          </div>
          {status === 'PROTECTED' && (
            <div className="space-y-4">
              <label className="block">
                Protected member
                <select
                  required
                  className={fieldClass}
                  value={member}
                  onChange={(e) => {
                    edit();
                    setMember(e.target.value);
                  }}
                >
                  <option value="">Choose member from reviewed evidence</option>
                  {members.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} · {m.employeeId}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  Protected from
                  <input
                    required
                    type="date"
                    className={fieldClass}
                    value={from}
                    onChange={(e) => {
                      edit();
                      setFrom(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Protected through (inclusive)
                  <input
                    required
                    type="date"
                    min={from || undefined}
                    className={fieldClass}
                    value={through}
                    onChange={(e) => {
                      edit();
                      setThrough(e.target.value);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
          <label className="block">
            Authoritative source reference
            <input
              required
              minLength={4}
              maxLength={500}
              className={fieldClass}
              value={source}
              onChange={(e) => {
                edit();
                setSource(e.target.value);
              }}
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
              onChange={(e) => {
                edit();
                setReason(e.target.value);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button className={buttonClass} type="submit">
              {busy ? 'Saving…' : 'Record reviewed tenure'}
            </button>
            <button className={buttonClass} type="button" disabled={!dirty} onClick={clear}>
              Discard edits
            </button>
          </div>
        </fieldset>
      </form>
      {dirty && (
        <RetainedEvidenceReview
          key={seat}
          disabled={busy}
          load={async () => {
            const fresh = await history.refetch();
            if (fresh.error || !fresh.data)
              throw new Error('Tenure history could not be refreshed');
            const value = Math.max(0, ...fresh.data.records.map((r) => r.revision));
            return { value, label: `Tenure revision ${value}` };
          }}
          useRevision={(value) => {
            expected.current = value;
            pending.current = null;
          }}
        />
      )}
      {message && <output className="block rounded border border-slate-600 p-3">{message}</output>}
      <section className="space-y-3">
        <h2 className="font-heading text-xl">Evidence history</h2>
        <p className="text-sm text-slate-300">
          Corrections append a dated revision. A newer revision does not change existing frozen
          sessions.
        </p>
        {history.data?.records.map((r) => (
          <article key={r.id} className="rounded border border-slate-700 bg-slate-900 p-4 text-sm">
            <p className="font-semibold">
              Revision {r.revision} · {r.effectiveOn} · {r.status}
            </p>
            {r.status === 'PROTECTED' && (
              <p>
                Member {r.memberId} · {r.protectedFrom} through {r.protectedThrough}
              </p>
            )}
            <p className="mt-2 break-words">{r.sourceRef}</p>
            <p>{r.reason}</p>
            <p className="mt-2 text-slate-400">
              Reviewed by {r.actorSubject} · {r.id}
            </p>
          </article>
        ))}
        {history.data?.records.length === 0 && (
          <p>
            No tenure evidence has been recorded for this seat. Absence of a record does not
            establish that a term is unprotected.
          </p>
        )}
      </section>
    </div>
  );
}
