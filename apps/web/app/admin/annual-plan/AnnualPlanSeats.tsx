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
type PlanSeat = {
  id: string;
  shift: string;
  station: string;
  unit: string;
  rank: string;
  name: string;
  participation: string;
  participationSource: string | null;
  staffingPositionId: string | null;
  bindingStatus: string | null;
  isFloating: number;
  isVacantByDesign: number;
  isExcludedFromCount: number;
};
export function AnnualPlanSeats({
  plan,
  onDirty,
  onSaved,
}: { plan: AnnualPlan; onDirty(v: boolean): void; onSaved(): Promise<void> }) {
  const roster = useQuery({
    queryKey: ['admin', 'current-roster', plan.effectiveOn],
    queryFn: () =>
      annualGet<{ positions: { id: string; stableSlotKey: string }[] }>(
        `current-roster?as_of=${plan.effectiveOn}`,
      ),
    staleTime: 30_000,
  });
  const planned = useQuery({
    queryKey: ['admin', 'annual-plan', plan.year, 'seats'],
    queryFn: () => annualGet<{ seats: PlanSeat[] }>(`annual-plan/${plan.year}/seats`),
    staleTime: 30_000,
    refetchInterval: plan.lifecycle === 'DRAFT' ? 60_000 : false,
  });
  const [target, setTarget] = useState<PlanSeat | null>(null);
  const [remove, setRemove] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReturnType<typeof expectedPlan> | null>(
    null,
  );
  const [seat, setSeat] = useState('');
  const [participation, setParticipation] = useState('');
  const [floating, setFloating] = useState('');
  const [vacant, setVacant] = useState('');
  const [excluded, setExcluded] = useState('');
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef<ReturnType<typeof expectedPlan> | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const dirty = !!(
    target ||
    seat ||
    participation ||
    floating ||
    vacant ||
    excluded ||
    evidence ||
    reason
  );
  useUnsavedChanges(dirty, 'annual seat edits');
  function edit() {
    if (!revision.current) revision.current = expectedPlan(plan);
    onDirty(true);
  }
  function clearDraft() {
    setTarget(null);
    setRemove(false);
    setConfirmed(false);
    setSeat('');
    setParticipation('');
    setFloating('');
    setVacant('');
    setExcluded('');
    setEvidence('');
    setReason('');
    setReconciliation(null);
    revision.current = null;
    pending.current = null;
    onDirty(false);
  }
  function selectTarget(row: PlanSeat, removing: boolean) {
    if (dirty && !window.confirm('Discard unsaved seat review edits?')) return;
    clearDraft();
    setTarget(row);
    setRemove(removing);
    setSeat(row.staffingPositionId ?? '');
    setFloating(row.isFloating ? 'yes' : 'no');
    setVacant(row.isVacantByDesign ? 'yes' : 'no');
    setExcluded(row.isExcludedFromCount ? 'yes' : 'no');
    revision.current = expectedPlan(plan);
    onDirty(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!revision.current) return;
    setBusy(true);
    setMessage('');
    const body =
      remove && target
        ? {
            ...revision.current,
            position_ids: [target.id],
            confirm_remove: confirmed,
            evidence_ref: evidence,
            reason,
          }
        : {
            ...revision.current,
            seats: [
              {
                ...(target ? { existing_position_id: target.id } : {}),
                staffing_position_id: seat,
                bid_participation: participation,
                is_floating: floating === 'yes',
                is_vacant_by_design: vacant === 'yes',
                is_excluded_from_count: excluded === 'yes',
              },
            ],
            evidence_ref: evidence,
            reason,
          };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost(
        `annual-plan/${plan.year}/seats${remove ? '/remove' : ''}`,
        body,
        pending.current.key,
      );
      clearDraft();
      await onSaved();
      setMessage(
        remove
          ? 'Seat removed from this annual draft. Review the updated rules and impact.'
          : 'Annual seat review saved. Reconcile its requirements in stage 4.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Seat save failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-slate-300">
        Maintain the organization and authorized seats as of {plan.effectiveOn}, then explicitly
        include reviewed seats in this annual plan.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link className={buttonClass} href={'/admin/personnel/tenure' as Route}>
          Tenure and protection review
        </Link>
        <Link className={buttonClass} href={'/admin/organization' as Route}>
          Organization and seat links
        </Link>
        <Link className={buttonClass} href={'/admin/staffing-structure' as Route}>
          Authorized staffing seats
        </Link>
      </div>
      <section className="space-y-3">
        <h2 className="font-heading text-xl">Seats in this annual plan</h2>
        <p className="text-sm text-slate-300">
          Inherited labels and participation require a fresh review. Bind each retained seat to its
          reviewed authorized staffing seat; the selected dated organization supplies its current
          label and rank.
        </p>
        {planned.isPending && <p>Loading annual seats…</p>}
        {planned.data?.seats.length === 0 && <p>No seats included yet.</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {planned.data?.seats.map((row) => (
            <article key={row.id} className="min-w-0 rounded border border-slate-600 p-4">
              <h3 className="break-words font-semibold">
                {row.shift} · {row.station} · {row.unit} · {row.name}
              </h3>
              <p className="mt-1 text-sm">
                {row.rank} · {row.participation.replaceAll('_', ' ')}
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {row.bindingStatus === 'approved' &&
                row.participationSource &&
                !row.participationSource.startsWith('inherited-unreviewed:')
                  ? 'Reviewed annual binding and participation'
                  : 'Annual binding or participation requires review'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || plan.lifecycle !== 'DRAFT'}
                  onClick={() => selectTarget(row, false)}
                >
                  Review seat
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || plan.lifecycle !== 'DRAFT'}
                  onClick={() => selectTarget(row, true)}
                >
                  Remove from annual draft
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      {(roster.isError || planned.isError) && (
        <p role="alert">
          Authorized seats could not be refreshed. Previously loaded choices may be stale.
        </p>
      )}
      <form onSubmit={save} onChange={edit} className="space-y-4">
        <fieldset disabled={busy || plan.lifecycle !== 'DRAFT'} className="space-y-4">
          <h2 className="font-heading text-xl">
            {target
              ? remove
                ? 'Review annual seat removal'
                : 'Review existing annual seat'
              : 'Add an authorized seat'}
          </h2>
          {target && (
            <p className="text-sm text-slate-300">
              Selected annual seat: {target.shift} · {target.station} · {target.unit} ·{' '}
              {target.name}.{' '}
              {remove
                ? 'This removes its rules, participation and binding from this annual draft. Historical sessions and the authorized staffing seat are preserved.'
                : 'Choose participation explicitly. Compare the selected authorized seat with these inherited details before saving.'}
            </p>
          )}
          {!remove && (
            <>
              <label className="block">
                Authorized seat
                <select
                  required
                  className={fieldClass}
                  value={seat}
                  onChange={(e) => setSeat(e.target.value)}
                >
                  <option value="">Choose a reviewed seat</option>
                  {roster.data?.positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.stableSlotKey}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Annual participation
                <select
                  required
                  className={fieldClass}
                  value={participation}
                  onChange={(e) => setParticipation(e.target.value)}
                >
                  <option value="">Choose participation</option>
                  <option value="BIDDABLE">Biddable</option>
                  <option value="RESERVED_NON_BIDDABLE">Reserved · Not biddable</option>
                  <option value="ADMIN_ASSIGNED_NON_BIDDABLE">
                    Administratively assigned · Not biddable
                  </option>
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: 'Floating seat', value: floating, set: setFloating },
                  { label: 'Vacant by design', value: vacant, set: setVacant },
                  { label: 'Excluded from staffing count', value: excluded, set: setExcluded },
                ].map((f) => (
                  <label key={f.label}>
                    {f.label}
                    <select
                      required
                      className={fieldClass}
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                    >
                      <option value="">Choose</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}
          <label className="block">
            Reviewed source reference
            <input
              required
              minLength={4}
              maxLength={500}
              className={fieldClass}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <label className="block">
            Reason
            <input
              required
              minLength={4}
              maxLength={500}
              className={fieldClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {remove && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed removal of this seat from the annual draft.
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={buttonClass}>
              {busy
                ? 'Saving…'
                : remove
                  ? 'Confirm reviewed removal'
                  : target
                    ? 'Save reviewed annual seat'
                    : 'Add reviewed seat to annual plan'}
            </button>
            {dirty && (
              <button type="button" className={buttonClass} onClick={clearDraft}>
                Discard seat edits
              </button>
            )}
          </div>
        </fieldset>
      </form>
      {dirty && (
        <section className="space-y-2">
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={async () => {
              try {
                const fresh = await annualGet<{ plan: AnnualPlan }>(`annual-plan/${plan.year}`);
                setReconciliation(expectedPlan(fresh.plan));
                await planned.refetch();
                setMessage(
                  'Review the refreshed annual seats above before applying your retained edits against the new revision.',
                );
              } catch (e) {
                setMessage(e instanceof Error ? e.message : 'Latest source unavailable');
              }
            }}
          >
            Review latest plan without discarding edits
          </button>
          {reconciliation && (
            <div className="rounded border border-amber-500 p-3 text-sm">
              <p>
                Refreshed rule revision {reconciliation.expected_rule_revision}; configuration
                revision {reconciliation.expected_configuration_revision}; source revision{' '}
                {reconciliation.expected_source_revision}.
              </p>
              <button
                type="button"
                className={`${buttonClass} mt-2`}
                onClick={() => {
                  revision.current = reconciliation;
                  pending.current = null;
                  setReconciliation(null);
                  setMessage(
                    'Retained edits now use the reviewed revision. Submit again when the proposal is ready.',
                  );
                }}
              >
                Use reviewed revision and keep edits
              </button>
            </div>
          )}
        </section>
      )}
      {message && (
        <output className="block whitespace-pre-wrap rounded border border-slate-600 p-3">
          {message}
        </output>
      )}
    </div>
  );
}
