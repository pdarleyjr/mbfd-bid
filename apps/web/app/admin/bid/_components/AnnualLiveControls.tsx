'use client';

import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { ADayGroupIdSchema, WeekdaySchema } from '@mbfd/shared';
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
type FallbackReview = {
  pool?: { poolId: string } | null;
  positionId: string;
  policyId: string;
  label: string;
  sourceRef: string;
  exhausted?: Array<{ tierId: string; eligibleMemberIds: number[]; reason: string }>;
} & (
  | { ok: false; code: string }
  | {
      ok: true;
      tierId: string;
      tierLabel: string;
      mode: 'VOLUNTARY' | 'FORCED';
      candidateMemberIds: number[];
      eligibleMemberIds: number[];
      comparator: Array<{ key: string; direction: string }>;
      sourceDecisionId: string;
    }
);
type SpecialtyState = {
  membership_distributions?: Array<{
    id: string;
    label: string;
    membershipSource: string;
    memberIds: number[];
    sourceRef: string;
  }>;
  sequence: number;
  term_participation?: Record<
    string,
    {
      assignmentId: string;
      sourceRef: string;
      protected: boolean;
      memberMayLeave: true;
      voluntaryOnly: true;
    }
  >;
  a_day_selection?: 'SIMULTANEOUS' | null;
  fallbacks?: FallbackReview[];
  opportunity_pools?: Array<{
    id: string;
    label: string;
    kind: 'STATION_POOL' | 'FLOAT_POOL';
    sourceRef: string;
    sourceDecisionId: string;
    positionIds: string[];
    valid: boolean;
    code: string | null;
    capacity: number;
    remaining: number;
    resolvedPositionId: string | null;
    shift: string | null;
  }>;
  current_bidder: Candidate | null;
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
  specialty_coverage?:
    | {
        availability: 'AVAILABLE';
        source: 'FROZEN_SESSION_SNAPSHOT';
        status: 'FEASIBLE' | 'AT_RISK' | 'SHORTAGE';
        total_specialty_seat_count: number;
        filled_specialty_seat_count: number;
        remaining_specialty_seat_count: number;
        maximum_remaining_covered_count: number;
        guaranteed_uncovered_seat_count: number;
        unmatched_seat_ids: readonly string[];
        critical_member_ids: readonly number[];
        rule_groups: ReadonlyArray<{
          rule_group_id: string;
          total_seat_count: number;
          filled_seat_count: number;
          remaining_seat_count: number;
          simple_eligible_member_ids: readonly number[];
        }>;
      }
    | {
        availability: 'UNAVAILABLE';
        source: 'FROZEN_SESSION_SNAPSHOT';
        code: string;
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

function aDayOptions(position: PositionMeta | undefined): readonly string[] {
  if (position?.shift === 'D') return WeekdaySchema.options;
  if (position) return ADayGroupIdSchema.options;
  return [...ADayGroupIdSchema.options, ...WeekdaySchema.options];
}

function useAwardADay(identity: string) {
  const [choice, setChoice] = useState({ identity, value: '' });
  useEffect(() => {
    setChoice({ identity, value: '' });
  }, [identity]);
  return [
    choice.identity === identity ? choice.value : '',
    (value: string) => setChoice({ identity, value }),
  ] as const;
}

function ADayChoice({
  label,
  position,
  value,
  onChange,
}: {
  label: string;
  position: PositionMeta | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Label className="mt-2 block w-full text-sm">
      {label}
      <NativeSelect
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full"
      >
        <option value="">Select A-Day</option>
        {aDayOptions(position).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </NativeSelect>
    </Label>
  );
}

export function AnnualLiveControls(props: Props) {
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [state, setState] = useState<SpecialtyState | null>(null);
  const [panel, setPanel] = useState<
    'selection' | 'specialty' | 'fallback' | 'presentation' | 'amendment' | 'order' | null
  >(null);
  const pendingCommand = useRef<{
    fingerprint: string;
    commandId: string;
    expectedSeq: number;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [amendFrom, setAmendFrom] = useState('');
  const [amendTo, setAmendTo] = useState('');
  const [selectionPositionId, setSelectionPositionId] = useState('');
  const [selectionPoolId, setSelectionPoolId] = useState('');
  const [membershipChoice, setMembershipChoice] = useState<{
    memberId: number | null;
    ids: string[];
  }>({ memberId: null, ids: [] });
  const [amendPoolId, setAmendPoolId] = useState('');
  const poolSlots = new Set(state?.opportunity_pools?.flatMap((pool) => pool.positionIds) ?? []);
  const [fallbackKey, setFallbackKey] = useState('');
  const fallback = state?.fallbacks?.find(
    (entry) => JSON.stringify([entry.policyId, entry.positionId]) === fallbackKey,
  );
  const fallbackMemberId = fallback?.ok ? fallback.candidateMemberIds[0] : undefined;
  const fallbackPosition = props.positions?.find(
    (position) => position.id === fallback?.positionId,
  );
  const [fallbackADay, setFallbackADay] = useAwardADay(
    JSON.stringify([
      props.bidSessionId,
      fallbackKey,
      fallback?.ok ? fallback.tierId : null,
      fallbackMemberId,
      fallbackPosition?.shift,
    ]),
  );
  const simultaneousADay = state?.a_day_selection === 'SIMULTANEOUS';
  const termMemberId =
    panel === 'selection'
      ? state?.current_bidder?.member_id
      : panel === 'amendment'
        ? state?.fills[amendFrom]?.member_id
        : panel === 'specialty'
          ? state?.active?.current_candidate_id
          : panel === 'fallback'
            ? fallbackMemberId
            : null;
  const termRight =
    termMemberId == null ? undefined : state?.term_participation?.[String(termMemberId)];
  const termIdentity = JSON.stringify([
    props.bidSessionId,
    state?.sequence,
    panel,
    termMemberId,
    termRight?.assignmentId,
    selectionPositionId,
    selectionPoolId,
    amendFrom,
    amendTo,
    fallbackKey,
    state?.active?.requested_position_id,
  ]);
  const [termChoice, setTermChoice] = useState({ identity: '', confirmed: false, evidence: '' });
  const termConfirmed = termChoice.identity === termIdentity && termChoice.confirmed;
  const termEvidence = termChoice.identity === termIdentity ? termChoice.evidence : '';
  const selectionPosition = props.positions?.find(
    (position) => position.id === selectionPositionId,
  );
  const amendmentPosition = props.positions?.find((position) => position.id === amendTo);
  const specialtyPosition = props.positions?.find(
    (position) => position.id === state?.active?.requested_position_id,
  );
  const [selectionADay, setSelectionADay] = useAwardADay(
    JSON.stringify([
      props.bidSessionId,
      state?.current_bidder?.member_id,
      selectionPositionId,
      selectionPosition?.shift,
    ]),
  );
  const [amendADay, setAmendADay] = useAwardADay(
    JSON.stringify([props.bidSessionId, amendFrom, amendTo, amendmentPosition?.shift]),
  );
  const [specialtyADay, setSpecialtyADay] = useAwardADay(
    JSON.stringify([
      props.bidSessionId,
      state?.active?.requested_position_id,
      state?.active?.current_candidate_id,
      specialtyPosition?.shift,
    ]),
  );
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

  useEffect(() => {
    if (selectionPositionId && state?.fills[selectionPositionId] !== undefined) {
      setSelectionPositionId('');
      setSelectionPoolId('');
    }
  }, [selectionPositionId, state]);

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

  async function command(type: string, inputDetail: Record<string, unknown> = {}) {
    let detail = inputDetail;
    if (
      type === 'live.record_selection' &&
      membershipChoice.memberId === inputDetail.memberId &&
      membershipChoice.ids.length
    )
      detail = { ...detail, membershipIds: membershipChoice.ids };
    if (reason.trim().length < 1 || state === null) {
      setNotice('Enter an operator reason and wait for the current bid to load.');
      return;
    }
    const awardsPosition =
      type === 'live.record_selection' ||
      type === 'live.force_selection' ||
      type === 'live.amend_selection' ||
      (type === 'live.resolve_specialty_candidate' && detail.outcome === 'ACCEPT');
    if (simultaneousADay && awardsPosition && !detail.aDay) {
      setNotice('Select an A-Day before recording this award.');
      return;
    }
    const departure = awardsPosition
      ? state.term_participation?.[String(detail.memberId)]
      : undefined;
    if (departure) {
      if (type === 'live.force_selection') {
        setNotice('This member may leave the current term only by an explicit voluntary choice.');
        return;
      }
      if (termMemberId !== detail.memberId || !termConfirmed || termEvidence.trim().length < 4) {
        setNotice(
          'Record the member’s explicit voluntary departure choice and its evidence before awarding another assignment.',
        );
        return;
      }
      detail = {
        ...detail,
        termDeparture: {
          assignmentId: departure.assignmentId,
          memberConfirmed: true,
          evidenceReference: termEvidence.trim(),
        },
      };
    }
    setBusy(true);
    setNotice(null);
    const fingerprint = JSON.stringify({
      type,
      detail,
      reason: reason.trim(),
      evidenceReference: evidenceReference.trim(),
    });
    if (pendingCommand.current?.fingerprint !== fingerprint)
      pendingCommand.current = {
        fingerprint,
        commandId: crypto.randomUUID(),
        expectedSeq: state.sequence,
      };
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${encodeURIComponent(props.bidSessionId)}/commands/live`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            v: 1,
            type,
            commandId: pendingCommand.current.commandId,
            expectedSeq: pendingCommand.current.expectedSeq,
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
      if (body?.kind === 'rejected') pendingCommand.current = null;
      if (!response.ok || body?.kind !== 'accepted')
        throw new Error(body?.error ?? body?.code ?? `Command failed (${response.status}).`);
      pendingCommand.current = null;
      if (awardsPosition) {
        setTermChoice({ identity: '', confirmed: false, evidence: '' });
        setSelectionADay('');
        setAmendADay('');
        setSpecialtyADay('');
        setFallbackADay('');
      }
      setNotice('Action recorded.');
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

  function memberName(memberId: number) {
    const member = props.members[String(memberId)];
    return member
      ? `${member.rank} ${member.firstName} ${member.lastName}`.trim()
      : `Member ${memberId}`;
  }

  return (
    <section className="border-y border-border bg-card p-3" data-testid="annual-live-controls">
      {state?.active && (
        <output className="mb-3 block text-sm font-semibold text-amber-800">
          {state.active.specialty_label} review is active. Open Specialty and contact to continue.
        </output>
      )}
      {props.isMock ? (
        <p className="mb-4 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-sky-900">
          MOCK REHEARSAL — canonical commands remain isolated from staffing and portal write-back.
        </p>
      ) : null}
      {state?.specialty_coverage ? (
        <section
          className="mb-4 rounded border border-border bg-muted/30 px-3 py-2 text-sm"
          data-testid="specialty-coverage-advisory"
          aria-live="polite"
        >
          <h2 className="font-semibold text-foreground">Specialty coverage advisory</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only advisory from the frozen session snapshot and canonical fills. It does not
            approve, block, or change an operator action.
          </p>
          {state.specialty_coverage.availability === 'UNAVAILABLE' ? (
            <p className="mt-2 text-sm text-warning">
              Frozen specialty coverage is unavailable: {state.specialty_coverage.code}.
            </p>
          ) : (
            <div className="mt-2 space-y-1 text-sm">
              <p>
                Status: <strong>{state.specialty_coverage.status.replace('_', ' ')}</strong> ·{' '}
                {state.specialty_coverage.filled_specialty_seat_count} of{' '}
                {state.specialty_coverage.total_specialty_seat_count} specialty seats filled ·{' '}
                {state.specialty_coverage.remaining_specialty_seat_count} remaining.
              </p>
              {state.specialty_coverage.guaranteed_uncovered_seat_count > 0 ? (
                <p className="text-warning">
                  {state.specialty_coverage.guaranteed_uncovered_seat_count} remaining specialty{' '}
                  {state.specialty_coverage.guaranteed_uncovered_seat_count === 1
                    ? 'seat is'
                    : 'seats are'}{' '}
                  uncovered by the frozen eligibility graph.
                </p>
              ) : null}
              {state.specialty_coverage.critical_member_ids.length > 0 ? (
                <p>
                  {state.specialty_coverage.critical_member_ids.length} frozen candidate
                  {state.specialty_coverage.critical_member_ids.length === 1 ? ' is' : 's are'}{' '}
                  critical to the remaining coverage.
                </p>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['selection', 'Record selection'],
            ['specialty', 'Specialty and contact'],
            ['fallback', 'Fallback awards'],
            ['presentation', 'Presentation'],
            ['amendment', 'Correct selection'],
            ['order', 'Remaining order'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            aria-expanded={panel === id}
            onClick={() => setPanel(panel === id ? null : id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {state?.active && (
        <p className="mt-2 text-sm text-warning">
          Specialty review in progress: {state.active.specialty_label}.{' '}
          <Button type="button" onClick={() => setPanel('specialty')}>
            Continue review
          </Button>
        </p>
      )}
      {notice && <output className="mt-2 block text-sm">{notice}</output>}
      <TaskPanel
        open={panel !== null}
        onClose={() => {
          setPanel(null);
        }}
        title={
          panel === 'specialty'
            ? 'Specialty and contact'
            : panel === 'fallback'
              ? 'Fallback awards'
              : panel === 'presentation'
                ? 'Department presentation'
                : panel === 'amendment'
                  ? 'Correct a recorded selection'
                  : panel === 'order'
                    ? 'Remaining bid order'
                    : 'Record selection'
        }
        description="Actions follow this session’s approved policy and your operator authority. Enter a reason and review the selected member or position before recording an action."
      >
        {termRight && termMemberId != null && (
          <fieldset className="space-y-3 rounded border border-amber-500 p-3">
            <legend className="font-semibold">Voluntary departure from a term assignment</legend>
            <p className="text-sm">
              {memberName(termMemberId)} may choose another assignment based on reviewed service
              evidence. The current position stays closed, and this member cannot be forced out.
            </p>
            <Label className="flex items-center gap-2">
              <Input
                type="checkbox"
                checked={termConfirmed}
                className="h-4 w-4"
                onChange={(event) =>
                  setTermChoice({
                    identity: termIdentity,
                    confirmed: event.target.checked,
                    evidence: termEvidence,
                  })
                }
              />
              Member explicitly chose to leave the current term assignment
            </Label>
            <Label className="block">
              Voluntary departure evidence
              <Input
                value={termEvidence}
                onChange={(event) =>
                  setTermChoice({
                    identity: termIdentity,
                    confirmed: termConfirmed,
                    evidence: event.target.value,
                  })
                }
              />
            </Label>
            <p className="text-xs text-muted-foreground">
              Reviewed term source: {termRight.sourceRef}
            </p>
          </fieldset>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="text-xs font-bold uppercase tracking-wide text-red-700">
              Bid-day actions
            </p>
            <h2 className="font-heading text-lg text-foreground">Review and record an action</h2>
          </div>
          <Label className="min-w-0 w-full text-xs text-muted-foreground">
            Operator reason
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm text-foreground"
            />
          </Label>
          <Label className="min-w-0 w-full text-xs text-muted-foreground">
            Evidence reference (when policy requires)
            <Input
              value={evidenceReference}
              onChange={(event) => setEvidenceReference(event.target.value)}
              className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm text-foreground"
            />
          </Label>
        </div>

        <div className="mt-4 space-y-4">
          <article hidden={panel !== 'fallback'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Review fallback award</h3>
            <p className="text-xs text-muted-foreground">
              Candidates and tier progression follow this session’s frozen policy and recorded
              responses.
            </p>
            <NativeSelect
              aria-label="Fallback opportunity"
              value={fallbackKey}
              onChange={(event) => setFallbackKey(event.target.value)}
              className="mt-2 block w-full"
            >
              <option value="">Select fallback opportunity</option>
              {state?.fallbacks?.map((entry) => (
                <option
                  key={JSON.stringify([entry.policyId, entry.positionId])}
                  value={JSON.stringify([entry.policyId, entry.positionId])}
                >
                  {entry.positionId} · {entry.label}
                </option>
              ))}
            </NativeSelect>
            {state && !state.fallbacks?.length ? (
              <p className="mt-2 text-sm">No open fallback opportunities.</p>
            ) : null}
            {fallback ? (
              <div className="mt-3 space-y-3 text-sm">
                <p>Source clause: {fallback.sourceRef}</p>
                {fallback.exhausted?.length ? (
                  <div>
                    <h4 className="font-semibold">Exhausted earlier tiers</h4>
                    <ul className="list-inside list-disc">
                      {fallback.exhausted.map((tier) => (
                        <li key={tier.tierId}>
                          {tier.tierId} · {tier.reason.replaceAll('_', ' ').toLowerCase()} ·{' '}
                          {tier.eligibleMemberIds.length} eligible candidates
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!fallback.ok ? (
                  <output>Fallback unavailable: {fallback.code}</output>
                ) : (
                  <>
                    <p>
                      <strong>Active tier: {fallback.tierLabel}</strong> ·{' '}
                      {fallback.mode === 'FORCED' ? 'Forced award' : 'Voluntary response'}
                    </p>
                    <p>Source decision: {fallback.sourceDecisionId}</p>
                    <p>
                      Candidate order:{' '}
                      {fallback.comparator
                        .map((entry) => `${entry.key.replaceAll('_', ' ')} (${entry.direction})`)
                        .join(', ')}
                    </p>
                    <p>
                      {fallback.eligibleMemberIds.length} eligible candidates in this tier. The
                      first remaining candidate is next.
                    </p>
                    <ol
                      className="list-inside list-decimal"
                      aria-label="Ordered fallback candidates"
                    >
                      {fallback.candidateMemberIds.map((memberId) => (
                        <li key={memberId}>{memberName(memberId)}</li>
                      ))}
                    </ol>
                    {fallbackMemberId === undefined ? (
                      <p>No remaining candidate is available.</p>
                    ) : (
                      <>
                        <p className="font-semibold">
                          Next candidate: {memberName(fallbackMemberId)}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(['PHONE', 'TEXT'] as const).map((method) => (
                            <Button
                              key={method}
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void command('live.record_contact_attempt', {
                                  memberId: fallbackMemberId,
                                  method,
                                })
                              }
                            >
                              Record fallback {method}
                            </Button>
                          ))}
                        </div>
                        {simultaneousADay ? (
                          <ADayChoice
                            label="Fallback award A-Day"
                            position={fallbackPosition}
                            value={fallbackADay}
                            onChange={setFallbackADay}
                          />
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            disabled={busy || (simultaneousADay && !fallbackADay)}
                            onClick={() => {
                              if (
                                fallback.mode === 'FORCED' &&
                                !window.confirm(
                                  `Confirm forced award to ${memberName(fallbackMemberId)} for ${fallback.positionId} under ${fallback.tierLabel}${simultaneousADay ? `, A-Day ${fallbackADay}` : ''}?`,
                                )
                              )
                                return;
                              void command(
                                fallback.mode === 'FORCED'
                                  ? 'live.force_selection'
                                  : 'live.record_selection',
                                {
                                  memberId: fallbackMemberId,
                                  positionId: fallback.positionId,
                                  fallback: {
                                    policyId: fallback.policyId,
                                    tierId: fallback.tierId,
                                  },
                                  ...(fallback.pool ? { pool: fallback.pool } : {}),
                                  ...(simultaneousADay ? { aDay: fallbackADay } : {}),
                                },
                              );
                            }}
                          >
                            {fallback.mode === 'FORCED'
                              ? 'Confirm forced award'
                              : 'Record voluntary acceptance'}
                          </Button>
                          {fallback.mode === 'VOLUNTARY'
                            ? (['DECLINE', 'UNREACHABLE'] as const).map((outcome) => (
                                <Button
                                  key={outcome}
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void command('live.record_fallback_response', {
                                      memberId: fallbackMemberId,
                                      positionId: fallback.positionId,
                                      fallback: {
                                        policyId: fallback.policyId,
                                        tierId: fallback.tierId,
                                      },
                                      outcome,
                                    })
                                  }
                                >
                                  {outcome === 'DECLINE'
                                    ? 'Record fallback decline'
                                    : 'Record fallback unreachable'}
                                </Button>
                              ))
                            : null}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </article>
          <article hidden={panel !== 'presentation'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Department presentation</h3>
            <p className="text-xs text-muted-foreground">
              Display controls never pause Bid execution.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ['OFF', 'OFF'],
                ['LIVE', 'LIVE'],
                ['HOLD', 'HOLD DISPLAY'],
                ['LIVE', 'RESUME DISPLAY'],
              ].map(([mode, label]) => (
                <Button
                  key={label}
                  type="button"
                  disabled={busy}
                  onClick={() => void command('live.set_presentation_mode', { mode })}
                  className="rounded border border-border px-3 py-2 text-sm text-foreground disabled:opacity-40"
                >
                  {label}
                </Button>
              ))}
            </div>
          </article>

          <article hidden={panel !== 'specialty'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Start specialty review</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <NativeSelect
                aria-label="Specialty"
                value={specialtyId}
                onChange={(event) => {
                  setSpecialtyId(event.target.value);
                  setPositionId('');
                }}
                className="rounded border border-border px-2 py-2 text-sm"
              >
                <option value="">Select specialty</option>
                {state?.specialties.map((specialty) => (
                  <option key={specialty.id} value={specialty.id}>
                    {specialty.label} · {specialty.mode}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Requested specialty position"
                value={positionId}
                onChange={(event) => setPositionId(event.target.value)}
                className="rounded border border-border px-2 py-2 text-sm"
              >
                <option value="">Requested real position</option>
                {selectedSpecialty?.positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.id} · {position.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              type="button"
              disabled={busy || !specialtyId || !positionId || state?.active !== null}
              onClick={() =>
                void command('live.start_specialty_adjudication', { specialtyId, positionId })
              }
              className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Suspend bidder and start
            </Button>
          </article>

          {state?.active ? (
            <article
              hidden={panel !== 'specialty'}
              className="rounded border border-amber-500 bg-amber-50 p-3 xl:col-span-2"
            >
              <h3 className="font-semibold text-amber-950">
                {state.active.specialty_label} interruption · {state.active.requested_position_id}
              </h3>
              <p className="mt-1 text-sm text-amber-900">
                Original bidder: {name(state.active.original_bidder)} ·{' '}
                {state.active.original_bidder.points ?? 0} points · policy rank{' '}
                {state.active.original_bidder.policy_rank ?? '—'} · turn suspended at queue{' '}
                {state.active.resume.queue_cursor}.
              </p>
              <div className="mt-3 max-h-[35dvh] overflow-auto">
                <Table className="w-full text-left text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Points/rank</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Contact history</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.active.candidates.map((candidate) => (
                      <TableRow key={candidate.member_id} className="border-t border-amber-200">
                        <TableCell className="py-2">{name(candidate)}</TableCell>
                        <TableCell>
                          {candidate.points ?? 0} / {candidate.policy_rank ?? '—'}
                        </TableCell>
                        <TableCell>{candidate.status}</TableCell>
                        <TableCell>
                          {candidate.contact_history
                            ?.map(
                              (attempt) =>
                                `${attempt.method} ${new Date(attempt.at_ms).toLocaleTimeString()}`,
                            )
                            .join(' · ') || 'None'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {currentCandidate ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <strong className="w-full text-sm text-amber-950">
                    Current contact: {name(currentCandidate)} · remaining{' '}
                    {state.active.remaining_candidate_ids.length}
                  </strong>
                  {simultaneousADay ? (
                    <ADayChoice
                      label="Specialty award A-Day"
                      position={specialtyPosition}
                      value={specialtyADay}
                      onChange={setSpecialtyADay}
                    />
                  ) : null}
                  {(['PHONE', 'TEXT'] as const).map((method) => (
                    <Button
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
                    </Button>
                  ))}
                  {(['ACCEPT', 'DECLINE', 'PASS', 'UNREACHABLE'] as const).map((outcome) => (
                    <Button
                      key={outcome}
                      type="button"
                      disabled={
                        busy || (outcome === 'ACCEPT' && simultaneousADay && !specialtyADay)
                      }
                      onClick={() =>
                        void command('live.resolve_specialty_candidate', {
                          memberId: currentCandidate.member_id,
                          outcome,
                          ...(outcome === 'ACCEPT' && simultaneousADay
                            ? { aDay: specialtyADay }
                            : {}),
                        })
                      }
                      className="rounded bg-amber-800 px-3 py-2 text-sm text-white"
                    >
                      {outcome}
                    </Button>
                  ))}
                </div>
              ) : null}
            </article>
          ) : null}

          <article hidden={panel !== 'selection'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Record current bidder selection</h3>
            <p className="text-xs text-muted-foreground">
              Canonical selection for the active member; the frozen stage policy remains enforced.
            </p>
            <NativeSelect
              aria-label="Position selected by current bidder"
              value={selectionPoolId ? '' : selectionPositionId}
              onChange={(event) => {
                setSelectionPositionId(event.target.value);
                setSelectionPoolId('');
              }}
              className="mt-2 block w-full rounded border border-border px-2 py-2 text-sm"
            >
              <option value="">Open opportunity</option>
              {props.positions
                ?.filter((position) => !poolSlots.has(position.id))
                .filter((position) =>
                  state === null
                    ? props.fills[position.id] === undefined
                    : state.fills[position.id] === undefined,
                )
                .map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.id} · {position.positionName}
                  </option>
                ))}
            </NativeSelect>
            {state?.opportunity_pools?.length ? (
              <Label className="mt-2 block text-sm">
                Station or float pool
                <NativeSelect
                  aria-label="Station or float pool"
                  value={selectionPoolId}
                  onChange={(event) => {
                    const pool = state.opportunity_pools?.find(
                      (entry) => entry.id === event.target.value,
                    );
                    setSelectionPoolId(pool?.id ?? '');
                    setSelectionPositionId(pool?.resolvedPositionId ?? '');
                  }}
                >
                  <option value="">Select a pool</option>
                  {state.opportunity_pools.map((pool) => (
                    <option
                      key={pool.id}
                      value={pool.id}
                      disabled={!pool.valid || pool.resolvedPositionId === null}
                    >
                      {pool.label} · {pool.remaining}/{pool.capacity} available
                      {pool.code ? ` · ${pool.code}` : ''}
                    </option>
                  ))}
                </NativeSelect>
                {selectionPoolId ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Source:{' '}
                    {state.opportunity_pools.find((pool) => pool.id === selectionPoolId)?.sourceRef}
                    . Daily unit placement remains a staffing decision.
                  </span>
                ) : null}
              </Label>
            ) : null}
            {simultaneousADay ? (
              <ADayChoice
                label="Selection A-Day"
                position={selectionPosition}
                value={selectionADay}
                onChange={setSelectionADay}
              />
            ) : null}
            {(state?.membership_distributions ?? [])
              .filter(
                (entry) =>
                  entry.membershipSource === 'REVIEWED_QUALIFIED_POOL' &&
                  entry.memberIds.includes(state?.current_bidder?.member_id ?? -1),
              )
              .map((entry) => (
                <Label key={entry.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      membershipChoice.memberId === state?.current_bidder?.member_id &&
                      membershipChoice.ids.includes(entry.id)
                    }
                    onChange={(event) => {
                      const memberId = state?.current_bidder?.member_id ?? null;
                      const ids =
                        membershipChoice.memberId === memberId ? membershipChoice.ids : [];
                      setMembershipChoice({
                        memberId,
                        ids: event.target.checked
                          ? [...ids, entry.id]
                          : ids.filter((id) => id !== entry.id),
                      });
                    }}
                  />
                  Elect {entry.label} membership with this selection
                </Label>
              ))}
            <Button
              type="button"
              disabled={
                busy ||
                state === null ||
                state.current_bidder === null ||
                !selectionPositionId ||
                (simultaneousADay && !selectionADay)
              }
              onClick={() =>
                void command('live.record_selection', {
                  memberId: state?.current_bidder?.member_id,
                  positionId: selectionPositionId,
                  ...(selectionPoolId ? { pool: { poolId: selectionPoolId } } : {}),
                  ...(simultaneousADay ? { aDay: selectionADay } : {}),
                })
              }
              className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Commit selection
            </Button>
          </article>

          <article hidden={panel !== 'amendment'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Amend latest committed selection</h3>
            <p className="text-xs text-muted-foreground">
              Same member only; sealed after the next commit.
            </p>
            <NativeSelect
              aria-label="Original filled opportunity"
              value={amendFrom}
              onChange={(event) => setAmendFrom(event.target.value)}
              className="mt-2 block w-full rounded border border-border px-2 py-2 text-sm"
            >
              <option value="">Original filled opportunity</option>
              {filled.map(([id, memberId]) => (
                <option key={id} value={id}>
                  {id} · {props.members[String(memberId)]?.lastName ?? `Member ${memberId}`}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="New open opportunity"
              value={amendPoolId ? '' : amendTo}
              onChange={(event) => {
                setAmendTo(event.target.value);
                setAmendPoolId('');
              }}
              className="mt-2 block w-full rounded border border-border px-2 py-2 text-sm"
            >
              <option value="">New open opportunity</option>
              {props.positions
                ?.filter((position) => !poolSlots.has(position.id))
                .filter((position) =>
                  state === null
                    ? props.fills[position.id] === undefined
                    : state.fills[position.id] === undefined,
                )
                .map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.id} · {position.positionName}
                  </option>
                ))}
            </NativeSelect>
            {state?.opportunity_pools?.length ? (
              <Label className="mt-2 block text-sm">
                Corrected station or float pool
                <NativeSelect
                  aria-label="Corrected station or float pool"
                  value={amendPoolId}
                  onChange={(event) => {
                    const pool = state.opportunity_pools?.find(
                      (entry) => entry.id === event.target.value,
                    );
                    setAmendPoolId(pool?.id ?? '');
                    setAmendTo(pool?.resolvedPositionId ?? '');
                  }}
                >
                  <option value="">Select a pool</option>
                  {state.opportunity_pools.map((pool) => (
                    <option
                      key={pool.id}
                      value={pool.id}
                      disabled={!pool.valid || pool.resolvedPositionId === null}
                    >
                      {pool.label} · {pool.remaining}/{pool.capacity} available
                    </option>
                  ))}
                </NativeSelect>
              </Label>
            ) : null}
            {simultaneousADay ? (
              <ADayChoice
                label="Corrected selection A-Day"
                position={amendmentPosition}
                value={amendADay}
                onChange={setAmendADay}
              />
            ) : null}
            <Button
              type="button"
              disabled={busy || !amendFrom || !amendTo || (simultaneousADay && !amendADay)}
              onClick={() =>
                void command('live.amend_selection', {
                  memberId:
                    state === null
                      ? props.fills[amendFrom]?.memberId
                      : state.fills[amendFrom]?.member_id,
                  fromPositionId: amendFrom,
                  toPositionId: amendTo,
                  ...(amendPoolId ? { pool: { poolId: amendPoolId } } : {}),
                  ...(simultaneousADay ? { aDay: amendADay } : {}),
                })
              }
              className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Amend opportunity
            </Button>
          </article>

          <article hidden={panel !== 'order'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Alter remaining order</h3>
            <ol className="mt-2 max-h-[40dvh] space-y-1 overflow-y-auto">
              {order.map((memberId, index) => (
                <li
                  key={memberId}
                  className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-sm"
                >
                  <span className="mr-auto">
                    {index + 1}. {props.members[String(memberId)]?.lastName ?? `Member ${memberId}`}
                  </span>
                  <Button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                    ↑
                  </Button>
                  <Button
                    type="button"
                    disabled={index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              disabled={busy || order.length === 0}
              onClick={() => void command('live.alter_order', { orderedRemainingMemberIds: order })}
              className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Commit remaining order
            </Button>
          </article>
        </div>
        {notice ? <output className="mt-3 block text-sm text-foreground">{notice}</output> : null}
      </TaskPanel>
    </section>
  );
}
