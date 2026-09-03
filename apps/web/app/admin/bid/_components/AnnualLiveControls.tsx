'use client';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MemberLite, PositionMeta } from '../../../_components/bid/types';

type Candidate = {
  member_id: number;
  first_name: string;
  last_name: string;
  rank: string | null;
  points?: number;
  status?: string;
  policy_rank?: number;
  contact_history?: Array<{ method: string; at_ms: number; actor_member_id: number }>;
};
type SpecialtyState = {
  sequence: number;
  remaining_order: number[];
  fills: Record<string, { member_id: number }>;
  specialties: Array<{
    id: string;
    label: string;
    mode: string;
    positions: Array<{ id: string; label: string }>;
  }>;
  active: null | {
    specialty_id: string;
    specialty_label: string;
    requested_position_id: string;
    original_bidder: Candidate;
    candidates: Candidate[];
    current_candidate_id: number | null;
    remaining_candidate_ids: number[];
    suspended_turn: boolean;
    resume: { member_id: number; queue_cursor: number; current_phase: string };
  };
};

interface Props {
  bidSessionId: string;
  isMock: boolean;
  currentBidderId: number | null;
  bidOrder: Array<{ memberId: number }>;
  fills: Record<string, { memberId: number }>;
  members: Record<string, MemberLite>;
  positions?: readonly PositionMeta[] | undefined;
}

function name(candidate: Candidate): string {
  return `${candidate.rank ?? ''} ${candidate.first_name} ${candidate.last_name}`.trim();
}

export function AnnualLiveControls(props: Props) {
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [state, setState] = useState<SpecialtyState | null>(null);
  const [reason, setReason] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [amendFrom, setAmendFrom] = useState('');
  const [amendTo, setAmendTo] = useState('');
  const orderSequence = useRef<number | null>(null);
  const [order, setOrder] = useState<number[]>(() => {
    const cursor = props.bidOrder.findIndex((entry) => entry.memberId === props.currentBidderId);
    return props.bidOrder.slice(Math.max(cursor, 0)).map((entry) => entry.memberId);
  });

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/admin/bid-session/${encodeURIComponent(props.bidSessionId)}/specialty-live`,
      { cache: 'no-store' },
    );
    const body = (await response.json().catch(() => null)) as
      | SpecialtyState
      | { error?: string }
      | null;
    if (!response.ok)
      throw new Error(
        body && 'error' in body ? body.error : `Live controls returned ${response.status}.`,
      );
    const next = body as SpecialtyState;
    if (orderSequence.current !== next.sequence) {
      orderSequence.current = next.sequence;
      setOrder(next.remaining_order);
    }
    setState(next);
  }, [props.bidSessionId]);

  useEffect(() => {
    void load().catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : 'Live controls unavailable.'),
    );
    const timer = setInterval(() => void load().catch(() => undefined), 2500);
    return () => clearInterval(timer);
  }, [load]);

  const selectedSpecialty =
    state?.specialties.find((specialty) => specialty.id === specialtyId) ?? null;
  const currentCandidate =
    state?.active?.candidates.find(
      (candidate) => candidate.member_id === state.active?.current_candidate_id,
    ) ?? null;
  const filled = useMemo(
    () =>
      state === null
        ? Object.entries(props.fills).map(([id, fill]) => [id, fill.memberId] as const)
        : Object.entries(state.fills).map(([id, fill]) => [id, fill.member_id] as const),
    [props.fills, state],
  );

  async function command(type: string, detail: Record<string, unknown> = {}) {
    if (reason.trim().length < 1 || state === null) {
      setNotice('Enter an operator reason and wait for canonical state.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${encodeURIComponent(props.bidSessionId)}/commands/live`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            v: 1,
            type,
            commandId: crypto.randomUUID(),
            expectedSeq: state.sequence,
            reason: reason.trim(),
            evidenceReference: evidenceReference.trim() || null,
            ...detail,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        kind?: string;
        code?: string;
        error?: string;
      } | null;
      if (!response.ok || body?.kind === 'rejected')
        throw new Error(body?.error ?? body?.code ?? `Command failed (${response.status}).`);
      setNotice('Canonical live command accepted.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Command failed.');
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, offset: number) {
    setOrder((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(target, 0, item);
      return next;
    });
  }

  return (
    <section className="border-y border-stone-300 bg-white p-4" data-testid="annual-live-controls">
      {props.isMock ? (
        <p className="mb-4 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-sky-900">
          MOCK REHEARSAL — canonical commands remain isolated from staffing and portal write-back.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="text-xs font-bold uppercase tracking-wide text-red-700">
            Canonical annual operations
          </p>
          <h2 className="font-heading text-lg text-stone-900">
            Specialty, presentation, amendment, and order
          </h2>
        </div>
        <label className="min-w-64 text-xs text-stone-600">
          Operator reason
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 block w-full rounded border border-stone-400 px-3 py-2 text-sm text-stone-900"
          />
        </label>
        <label className="min-w-64 text-xs text-stone-600">
          Evidence reference (when policy requires)
          <input
            value={evidenceReference}
            onChange={(event) => setEvidenceReference(event.target.value)}
            className="mt-1 block w-full rounded border border-stone-400 px-3 py-2 text-sm text-stone-900"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <article className="rounded border border-stone-300 p-3">
          <h3 className="font-semibold text-stone-900">Department presentation</h3>
          <p className="text-xs text-stone-600">Display controls never pause Bid execution.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ['OFF', 'OFF'],
              ['LIVE', 'LIVE'],
              ['HOLD', 'HOLD DISPLAY'],
              ['LIVE', 'RESUME DISPLAY'],
            ].map(([mode, label]) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => void command('live.set_presentation_mode', { mode })}
                className="rounded border border-stone-400 px-3 py-2 text-sm text-stone-800 disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>
        </article>

        <article className="rounded border border-stone-300 p-3">
          <h3 className="font-semibold text-stone-900">Start specialty review</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <select
              aria-label="Specialty"
              value={specialtyId}
              onChange={(event) => {
                setSpecialtyId(event.target.value);
                setPositionId('');
              }}
              className="rounded border border-stone-400 px-2 py-2 text-sm"
            >
              <option value="">Select specialty</option>
              {state?.specialties.map((specialty) => (
                <option key={specialty.id} value={specialty.id}>
                  {specialty.label} · {specialty.mode}
                </option>
              ))}
            </select>
            <select
              aria-label="Requested specialty position"
              value={positionId}
              onChange={(event) => setPositionId(event.target.value)}
              className="rounded border border-stone-400 px-2 py-2 text-sm"
            >
              <option value="">Requested real position</option>
              {selectedSpecialty?.positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.id} · {position.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={busy || !specialtyId || !positionId || state?.active !== null}
            onClick={() =>
              void command('live.start_specialty_adjudication', { specialtyId, positionId })
            }
            className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Suspend bidder and start
          </button>
        </article>

        {state?.active ? (
          <article className="rounded border border-amber-500 bg-amber-50 p-3 xl:col-span-2">
            <h3 className="font-semibold text-amber-950">
              {state.active.specialty_label} interruption · {state.active.requested_position_id}
            </h3>
            <p className="mt-1 text-sm text-amber-900">
              Original bidder: {name(state.active.original_bidder)} ·{' '}
              {state.active.original_bidder.points ?? 0} points · policy rank{' '}
              {state.active.original_bidder.policy_rank ?? '—'} · turn suspended at queue{' '}
              {state.active.resume.queue_cursor}.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Points/rank</th>
                    <th>Status</th>
                    <th>Contact history</th>
                  </tr>
                </thead>
                <tbody>
                  {state.active.candidates.map((candidate) => (
                    <tr key={candidate.member_id} className="border-t border-amber-200">
                      <td className="py-2">{name(candidate)}</td>
                      <td>
                        {candidate.points ?? 0} / {candidate.policy_rank ?? '—'}
                      </td>
                      <td>{candidate.status}</td>
                      <td>
                        {candidate.contact_history
                          ?.map(
                            (attempt) =>
                              `${attempt.method} ${new Date(attempt.at_ms).toLocaleTimeString()}`,
                          )
                          .join(' · ') || 'None'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {currentCandidate ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <strong className="w-full text-sm text-amber-950">
                  Current contact: {name(currentCandidate)} · remaining{' '}
                  {state.active.remaining_candidate_ids.length}
                </strong>
                {(['PHONE', 'TEXT'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void command('live.record_contact_attempt', {
                        memberId: currentCandidate.member_id,
                        method,
                      })
                    }
                    className="rounded border border-amber-600 px-3 py-2 text-sm"
                  >
                    Record {method}
                  </button>
                ))}
                {(['ACCEPT', 'DECLINE', 'PASS', 'UNREACHABLE'] as const).map((outcome) => (
                  <button
                    key={outcome}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void command('live.resolve_specialty_candidate', {
                        memberId: currentCandidate.member_id,
                        outcome,
                      })
                    }
                    className="rounded bg-amber-800 px-3 py-2 text-sm text-white"
                  >
                    {outcome}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ) : null}

        <article className="rounded border border-stone-300 p-3">
          <h3 className="font-semibold text-stone-900">Amend latest committed selection</h3>
          <p className="text-xs text-stone-600">Same member only; sealed after the next commit.</p>
          <select
            aria-label="Original filled opportunity"
            value={amendFrom}
            onChange={(event) => setAmendFrom(event.target.value)}
            className="mt-2 block w-full rounded border border-stone-400 px-2 py-2 text-sm"
          >
            <option value="">Original filled opportunity</option>
            {filled.map(([id, memberId]) => (
              <option key={id} value={id}>
                {id} · {props.members[String(memberId)]?.lastName ?? `Member ${memberId}`}
              </option>
            ))}
          </select>
          <select
            aria-label="New open opportunity"
            value={amendTo}
            onChange={(event) => setAmendTo(event.target.value)}
            className="mt-2 block w-full rounded border border-stone-400 px-2 py-2 text-sm"
          >
            <option value="">New open opportunity</option>
            {props.positions
              ?.filter((position) =>
                state === null
                  ? props.fills[position.id] === undefined
                  : state.fills[position.id] === undefined,
              )
              .map((position) => (
                <option key={position.id} value={position.id}>
                  {position.id} · {position.positionName}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={busy || !amendFrom || !amendTo}
            onClick={() =>
              void command('live.amend_selection', {
                memberId:
                  state === null
                    ? props.fills[amendFrom]?.memberId
                    : state.fills[amendFrom]?.member_id,
                fromPositionId: amendFrom,
                toPositionId: amendTo,
              })
            }
            className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Amend opportunity
          </button>
        </article>

        <article className="rounded border border-stone-300 p-3">
          <h3 className="font-semibold text-stone-900">Alter remaining order</h3>
          <ol className="mt-2 space-y-1">
            {order.map((memberId, index) => (
              <li
                key={memberId}
                className="flex items-center gap-2 rounded bg-stone-100 px-2 py-1 text-sm"
              >
                <span className="mr-auto">
                  {index + 1}. {props.members[String(memberId)]?.lastName ?? `Member ${memberId}`}
                </span>
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === order.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={busy || order.length === 0}
            onClick={() => void command('live.alter_order', { orderedRemainingMemberIds: order })}
            className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Commit remaining order
          </button>
        </article>
      </div>
      {notice ? <output className="mt-3 block text-sm text-stone-700">{notice}</output> : null}
    </section>
  );
}
