'use client';
import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import {
  OPERATOR_AUTH_REFRESHED,
  OPERATOR_REAUTH_STARTED,
  OPERATOR_STEP_UP_REQUIRED,
} from '@/lib/operator-step-up';
import { WeekdaySchema } from '@mbfd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MemberLite } from '../../../_components/bid/types';

type Source = {
  bidId: string;
  originalCommandId: string;
  originalADayCommandId: string | null;
  originalPositionId: string;
  memberId: number;
  status: 'ACTIVE' | 'REVOKED';
  aDay: string | null;
  membershipIds: string[];
  eligiblePositionIds: string[];
  termParticipation: { assignmentId: string } | null;
};
type Readback = {
  sequence: number;
  sealed: boolean;
  sources: Source[];
  positions: Array<{ id: string; label: string; shift: string }>;
  combatGroups: string[];
  opportunityPools: Array<{ id: string; positionIds: string[] }>;
};
type Award = {
  positionId: string;
  fill: { memberId: number; aDay?: string };
  aDay?: { aDay: string } | null;
};
type Preview = {
  valid: true;
  expectedSeq: number;
  before: Award;
  after: Award | null;
  memberId: number;
  reason: string;
  constraintEffects: Array<{ group: string; before: number; after: number }> | null;
  validated: string[] | null;
  warnings?: Array<{ code: string; message: string }>;
};
type Command = {
  v: 1;
  type: 'live.correct_bid';
  commandId: string;
  expectedSeq: number;
  memberId: number;
  reason: string;
  evidenceReference: null;
  originalCommandId: string;
  originalADayCommandId: string | null;
  originalBidId: string;
  originalPositionId: string;
  operation: 'REPLACE' | 'REVOKE';
  replacement: { positionId: string; aDay: string | null; membershipIds: string[] } | null;
  pool?: { poolId: string };
  termDeparture?: { assignmentId: string; memberConfirmed: true; evidenceReference: string };
  adminOverride?: { acknowledged: true; warningCodes: string[] };
};

function failure(code: string | undefined) {
  const messages: Record<string, string> = {
    step_up_required:
      'Refresh operator sign-in, then refresh awards and review this correction again. Your draft is retained.',
    session_revalidation_required:
      'Refresh operator sign-in, then refresh awards and review this correction again. Your draft is retained.',
    missing_auth: 'Refresh operator sign-in before reviewing a correction. Your draft is retained.',
    STALE_SEQUENCE: 'The bid changed. Refresh the awards and review the correction again.',
    ANNUAL_COMPLETION_SEALED: 'Final results are sealed. This bid cannot be corrected.',
    CORRECTION_SOURCE_NOT_ACTIVE:
      'This award has already changed. Refresh the awards before correcting it.',
    CORRECTION_SOURCE_RECEIPT_INVALID:
      'The original award receipt could not be verified. Refresh the awards.',
    CORRECTION_A_DAY_RECEIPT_REQUIRED:
      'The original A-Day receipt is required. Refresh the awards.',
    CORRECTION_ORDINARY_A_DAY_NOT_REACHED:
      'This early winner chooses A-Day at their ordinary turn. Keep that A-Day due.',
    POSITION_FILLED: 'That position is already awarded. Choose an open eligible position.',
    MEMBER_NOT_ELIGIBLE: 'The member does not qualify for that position under the frozen rules.',
    LIVE_STAGE_NOT_ELIGIBLE: 'That position is outside the member’s reached stages.',
    SPECIALTY_HIGHER_PRIORITY_UNRESOLVED:
      'Higher priority specialty candidates must be resolved before this award can be corrected.',
    SCOPED_A_DAY_MAXIMUM: 'That A-Day has reached a staffing limit. Choose another A-Day.',
    MEMBERSHIP_A_DAY_MAXIMUM_REACHED:
      'That group has reached its A-Day limit. Choose another A-Day.',
    live_action_forbidden: 'Your saved Bid authority does not permit corrections.',
  };
  return code && messages[code]
    ? messages[code]
    : 'The correction could not be approved under the saved Bid rules. Review the member, position and A-Day.';
}

/** A focused, compensating workflow. Source references are loaded once from
 * canonical readback; confirmation submits the exact server-reviewed command. */
export function CorrectBid(props: {
  bidSessionId: string;
  members: Record<string, MemberLite>;
  onCanonicalChange?: (() => void) | undefined;
  canonicalSequence?: number | undefined;
  commandsBlocked?: boolean | undefined;
  overrideAllowed?: boolean | undefined;
  overridePositionIds?: readonly string[] | undefined;
}) {
  const csrfFetch = useMemo(
    () =>
      createCsrfAwareFetch(
        (...args) => window.fetch(...args),
        () => window.location.origin,
      ),
    [],
  );
  const [open, setOpen] = useState(false);
  const [readback, setReadback] = useState<Readback | null>(null);
  const [readbackFresh, setReadbackFresh] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [operation, setOperation] = useState<'REPLACE' | 'REVOKE'>('REPLACE');
  const [positionId, setPositionId] = useState('');
  const [aDay, setADay] = useState('');
  const [reason, setReason] = useState('');
  const [termConfirmed, setTermConfirmed] = useState(false);
  const [termEvidence, setTermEvidence] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<{
    preview: Preview;
    command: Command;
    generation: number;
  } | null>(null);
  const inFlight = useRef(false);
  const contextGeneration = useRef(0);
  const minimumReadbackSequence = useRef(0);
  const latestContext = useRef({
    blocked: props.commandsBlocked === true,
    sequence: props.canonicalSequence,
  });
  latestContext.current = {
    blocked: props.commandsBlocked === true,
    sequence: props.canonicalSequence,
  };
  const sequenceChanged =
    props.canonicalSequence !== undefined &&
    readback !== null &&
    props.canonicalSequence > readback.sequence;
  const draftBlocked = busy || !readbackFresh || props.commandsBlocked === true || sequenceChanged;
  const source = readback?.sources.find((entry) => entry.bidId === sourceId);
  const draft = useRef({ source, positionId, aDay, operation });
  draft.current = { source, positionId, aDay, operation };
  useEffect(() => {
    function invalidate() {
      contextGeneration.current += 1;
      setReview(null);
      setOverrideAcknowledged(false);
      setReadbackFresh(false);
      setNotice(
        'Operator sign-in changed. Your draft is retained. Refresh awards and review the correction again before confirming.',
      );
    }
    for (const event of [
      OPERATOR_REAUTH_STARTED,
      OPERATOR_STEP_UP_REQUIRED,
      OPERATOR_AUTH_REFRESHED,
    ])
      window.addEventListener(event, invalidate);
    return () => {
      contextGeneration.current += 1;
      for (const event of [
        OPERATOR_REAUTH_STARTED,
        OPERATOR_STEP_UP_REQUIRED,
        OPERATOR_AUTH_REFRESHED,
      ])
        window.removeEventListener(event, invalidate);
    };
  }, []);
  useEffect(() => {
    if (!props.commandsBlocked && !sequenceChanged) return;
    contextGeneration.current += 1;
    setReview(null);
    setOverrideAcknowledged(false);
    setReadbackFresh(false);
    setNotice(
      'The bid or operator sign-in changed. Your draft is retained. Refresh awards and review the correction again.',
    );
  }, [props.commandsBlocked, sequenceChanged]);
  useEffect(() => {
    if (props.overrideAllowed === true || !overrideEnabled) return;
    contextGeneration.current += 1;
    setReview(null);
    setOverrideEnabled(false);
    setOverrideAcknowledged(false);
    setNotice('Administrator override authority changed. Review this correction again.');
  }, [props.overrideAllowed, overrideEnabled]);
  function contextCurrent(generation: number, sequence: number) {
    return (
      generation === contextGeneration.current &&
      !latestContext.current.blocked &&
      sequence >= minimumReadbackSequence.current &&
      (latestContext.current.sequence === undefined || sequence >= latestContext.current.sequence)
    );
  }
  const groupLabel = (value: string) =>
    /^G[1-4]$/.test(value) ? `Group ${value.slice(1)}` : value;
  const memberName = (id: number) => {
    const member = props.members[String(id)];
    return member ? `${member.rank} ${member.firstName} ${member.lastName}`.trim() : `Member ${id}`;
  };
  const positionName = (id: string) =>
    readback?.positions.find((entry) => entry.id === id)?.label ?? id;
  const options =
    readback?.positions.find((entry) => entry.id === positionId)?.shift === 'D'
      ? WeekdaySchema.options
      : (readback?.combatGroups ?? []);
  function choose(entry: Source | undefined) {
    setSourceId(entry?.bidId ?? '');
    setPositionId(
      entry?.status === 'ACTIVE' ? entry.originalPositionId : (entry?.eligiblePositionIds[0] ?? ''),
    );
    setADay(entry?.aDay ?? '');
    setOperation('REPLACE');
    setReview(null);
    setOverrideEnabled(false);
    setOverrideAcknowledged(false);
    setTermConfirmed(false);
    setTermEvidence('');
  }
  function edit() {
    setReview(null);
    setOverrideAcknowledged(false);
    setNotice(null);
  }
  async function load() {
    const generation = contextGeneration.current;
    const response = await csrfFetch(`/api/admin/bid-session/${props.bidSessionId}/corrections`, {
      cache: 'no-store',
    });
    const body = (await response.json()) as Readback & { error?: string };
    if (!response.ok) throw new Error(failure(body?.error));
    const data = body as Readback;
    if (!contextCurrent(generation, data.sequence))
      throw new Error(
        'Awards changed while loading. Refresh awards after operator sign-in and review again. Your draft is retained.',
      );
    setReadback(data);
    setReadbackFresh(true);
    const previous = draft.current;
    const retained = data.sources.find(
      (entry) =>
        entry.bidId === previous.source?.bidId &&
        entry.originalCommandId === previous.source.originalCommandId &&
        entry.originalADayCommandId === previous.source.originalADayCommandId &&
        entry.status === previous.source.status &&
        entry.termParticipation?.assignmentId === previous.source.termParticipation?.assignmentId,
    );
    if (
      retained &&
      (previous.operation === 'REVOKE' ||
        retained.eligiblePositionIds.includes(previous.positionId) ||
        (overrideEnabled &&
          props.overrideAllowed === true &&
          (previous.positionId === retained.originalPositionId ||
            props.overridePositionIds?.includes(previous.positionId))))
    ) {
      const days =
        data.positions.find((entry) => entry.id === previous.positionId)?.shift === 'D'
          ? WeekdaySchema.options
          : data.combatGroups;
      if (previous.aDay && !days.includes(previous.aDay)) {
        setADay('');
        setNotice('The drafted A-Day is no longer available. Choose an A-Day and review again.');
      }
    } else {
      choose(
        data.sources.find((entry) => entry.bidId === previous.source?.bidId) ?? data.sources[0],
      );
      if (previous.source)
        setNotice(
          'The original award or drafted position changed. Review the refreshed award before preparing a correction.',
        );
    }
  }
  async function start() {
    setOpen(true);
    setNotice(null);
    setBusy(true);
    setReadbackFresh(false);
    try {
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Awards could not be loaded. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (inFlight.current) return;
    setBusy(true);
    setReadbackFresh(false);
    setReview(null);
    setNotice(null);
    try {
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Awards could not be refreshed. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (!source || !readback || draftBlocked || inFlight.current) return;
    if (overrideEnabled && (props.overrideAllowed !== true || reason.trim().length < 4)) return;
    const generation = contextGeneration.current;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const pool = readback.opportunityPools.find((entry) => entry.positionIds.includes(positionId));
    const command: Command = {
      v: 1,
      type: 'live.correct_bid',
      commandId: crypto.randomUUID(),
      expectedSeq: readback.sequence,
      memberId: source.memberId,
      reason: reason.trim(),
      evidenceReference: null,
      originalCommandId: source.originalCommandId,
      originalADayCommandId: source.originalADayCommandId,
      originalBidId: source.bidId,
      originalPositionId: source.originalPositionId,
      operation,
      replacement:
        operation === 'REVOKE'
          ? null
          : { positionId, aDay: aDay || null, membershipIds: source.membershipIds },
      ...(pool && operation === 'REPLACE' ? { pool: { poolId: pool.id } } : {}),
      ...(source.termParticipation && operation === 'REPLACE'
        ? {
            termDeparture: {
              assignmentId: source.termParticipation.assignmentId,
              memberConfirmed: true,
              evidenceReference: termEvidence.trim(),
            },
          }
        : {}),
      ...(overrideEnabled
        ? { adminOverride: { acknowledged: true as const, warningCodes: [] } }
        : {}),
    };
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${props.bidSessionId}/${overrideEnabled ? 'commands/live/preview' : 'corrections/preview'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        },
      );
      const body = (await response.json()) as Partial<Preview> & { code?: string; error?: string };
      if (!contextCurrent(generation, readback.sequence)) return;
      if (!response.ok || body?.valid !== true) {
        setNotice(failure(body?.code ?? body?.error));
        return;
      }
      if (body.expectedSeq !== command.expectedSeq) {
        setReadbackFresh(false);
        setNotice('The bid changed during review. Refresh awards and review again.');
        return;
      }
      if (overrideEnabled) {
        if (
          body.memberId !== command.memberId ||
          body.before?.positionId !== command.originalPositionId ||
          (command.operation === 'REPLACE' &&
            body.after?.positionId !== command.replacement?.positionId) ||
          (command.operation === 'REVOKE' && body.after !== null) ||
          !Array.isArray(body.warnings) ||
          body.warnings.some(
            (warning) => typeof warning.code !== 'string' || typeof warning.message !== 'string',
          )
        ) {
          setNotice(
            'The override preview does not match this correction. Refresh awards and review again.',
          );
          return;
        }
        command.adminOverride = {
          acknowledged: true,
          warningCodes: body.warnings.map((warning) => warning.code),
        };
        setOverrideAcknowledged(false);
      }
      setReview({
        preview: {
          ...(body as Preview),
          reason: command.reason,
          constraintEffects: Array.isArray(body.constraintEffects) ? body.constraintEffects : null,
          validated: Array.isArray(body.validated) ? body.validated : null,
        },
        command,
        generation,
      });
    } catch {
      if (contextCurrent(generation, readback.sequence))
        setNotice('The review could not be loaded. Review the correction again when connected.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (
      !review ||
      draftBlocked ||
      inFlight.current ||
      !contextCurrent(review.generation, review.command.expectedSeq) ||
      (review.command.adminOverride !== undefined &&
        (props.overrideAllowed !== true || !overrideAcknowledged))
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${props.bidSessionId}/commands/live`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(review.command),
        },
      );
      const body = (await response.json()) as {
        kind?: string;
        code?: string;
        error?: string;
        seq?: number;
      };
      if (!response.ok || body?.kind !== 'accepted') {
        setNotice(failure(body?.code ?? body?.error));
        setReview(null);
        return;
      }
      setReview(null);
      setReadbackFresh(false);
      minimumReadbackSequence.current = Math.max(
        minimumReadbackSequence.current,
        review.command.expectedSeq + 1,
        typeof body.seq === 'number' && Number.isSafeInteger(body.seq) ? body.seq : 0,
      );
      setNotice('Correction recorded. Refreshing awards…');
      try {
        props.onCanonicalChange?.();
        await load();
        setNotice('Correction recorded. The award and capacity have been updated.');
      } catch {
        setNotice(
          'Correction recorded. Awards could not be refreshed. Refresh awards before recording another correction.',
        );
      }
    } catch {
      setNotice(
        'Delivery is uncertain. Confirm again to retry the same reviewed correction safely.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function award(value: Award | null) {
    return value ? (
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="font-medium">Member</dt>
          <dd>{memberName(value.fill.memberId)}</dd>
        </div>
        <div>
          <dt className="font-medium">Position</dt>
          <dd>{positionName(value.positionId)}</dd>
        </div>
        <div>
          <dt className="font-medium">A-Day</dt>
          <dd>{groupLabel(value.fill.aDay ?? value.aDay?.aDay ?? 'Due at ordinary turn')}</dd>
        </div>
      </dl>
    ) : (
      <p className="text-sm">
        Award revoked. Position and A-Day capacity returned. A corrected award is required before
        completion.
      </p>
    );
  }
  return (
    <>
      <Button
        variant="secondary"
        disabled={busy || props.commandsBlocked === true}
        onClick={() => void start()}
      >
        Correct a bid
      </Button>
      <TaskPanel
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="Correct a bid"
        description="Review the original award, check the proposed correction and confirm it with an operator reason."
      >
        {notice && (
          <output className="mb-4 block rounded border border-border p-3 text-sm">{notice}</output>
        )}
        <Button
          variant="secondary"
          disabled={busy || props.commandsBlocked === true}
          onClick={() => void refresh()}
        >
          Refresh awards
        </Button>
        {readback?.sealed ? (
          <p>Final results are sealed. Corrections are closed.</p>
        ) : readback && readback.sources.length === 0 ? (
          <p>No verified award is available to correct.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="correction-source">Award to correct</Label>
              <NativeSelect
                id="correction-source"
                value={sourceId}
                disabled={draftBlocked}
                onChange={(event) => {
                  choose(readback?.sources.find((entry) => entry.bidId === event.target.value));
                  setNotice(null);
                }}
              >
                <option value="">Choose an award</option>
                {readback?.sources.map((entry) => (
                  <option key={entry.bidId} value={entry.bidId}>
                    {memberName(entry.memberId)} — {positionName(entry.originalPositionId)}
                    {entry.status === 'REVOKED' ? ' (revoked)' : ''}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {source && (
              <>
                {props.overrideAllowed === true ? (
                  <Label className="flex min-h-11 items-start gap-2 border border-warning/30 bg-warning/5 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      aria-label="Use administrator override for correction"
                      checked={overrideEnabled}
                      disabled={draftBlocked}
                      onChange={(event) => {
                        edit();
                        setOverrideEnabled(event.target.checked);
                        if (
                          !event.target.checked &&
                          !source.eligiblePositionIds.includes(positionId)
                        ) {
                          setPositionId(source.originalPositionId);
                          setADay(source.aDay ?? '');
                        }
                      }}
                    />
                    Administrator override · correct to any open opportunity, with eligibility and
                    order advisories.
                  </Label>
                ) : null}
                <div>
                  <Label htmlFor="correction-operation">Correction</Label>
                  <NativeSelect
                    id="correction-operation"
                    value={operation}
                    disabled={draftBlocked}
                    onChange={(event) => {
                      edit();
                      setOperation(event.target.value as 'REPLACE' | 'REVOKE');
                    }}
                  >
                    <option value="REPLACE">Record corrected award</option>
                    {source.status === 'ACTIVE' && (
                      <option value="REVOKE">Undo erroneous award</option>
                    )}
                  </NativeSelect>
                </div>
                {operation === 'REPLACE' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="correction-position">Corrected position</Label>
                      <NativeSelect
                        id="correction-position"
                        value={positionId}
                        disabled={draftBlocked}
                        onChange={(event) => {
                          edit();
                          setPositionId(event.target.value);
                          setADay('');
                        }}
                      >
                        {(overrideEnabled
                          ? [
                              ...new Set([
                                source.originalPositionId,
                                ...(props.overridePositionIds ?? []),
                              ]),
                            ]
                          : source.eligiblePositionIds
                        ).map((id) => (
                          <option key={id} value={id}>
                            {positionName(id)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div>
                      <Label htmlFor="correction-a-day">Corrected A-Day</Label>
                      <NativeSelect
                        id="correction-a-day"
                        value={aDay}
                        disabled={draftBlocked}
                        onChange={(event) => {
                          edit();
                          setADay(event.target.value);
                        }}
                      >
                        <option value="">A-Day remains due at ordinary turn</option>
                        {options.map((day) => (
                          <option key={day} value={day}>
                            {groupLabel(day)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                )}
                {operation === 'REPLACE' && source.termParticipation && (
                  <fieldset className="space-y-2 rounded border border-border p-3">
                    <Label>
                      <input
                        type="checkbox"
                        checked={termConfirmed}
                        disabled={draftBlocked}
                        onChange={(event) => {
                          edit();
                          setTermConfirmed(event.target.checked);
                        }}
                      />{' '}
                      Member confirms leaving the current term assignment
                    </Label>
                    <Label htmlFor="correction-term-evidence">Election evidence</Label>
                    <Input
                      id="correction-term-evidence"
                      value={termEvidence}
                      disabled={draftBlocked}
                      onChange={(event) => {
                        edit();
                        setTermEvidence(event.target.value);
                      }}
                    />
                  </fieldset>
                )}
                <div>
                  <Label htmlFor="correction-reason">Operator reason</Label>
                  <textarea
                    id="correction-reason"
                    value={reason}
                    disabled={draftBlocked}
                    maxLength={500}
                    className="min-h-24 w-full rounded-md border border-input bg-background p-3"
                    onChange={(event) => {
                      edit();
                      setReason(event.target.value);
                    }}
                  />
                </div>
                <details className="text-sm">
                  <summary>Original audit reference</summary>
                  <p className="break-all">Award receipt: {source.originalCommandId}</p>
                  {source.originalADayCommandId && (
                    <p className="break-all">A-Day receipt: {source.originalADayCommandId}</p>
                  )}
                </details>
                {!review ? (
                  <Button
                    disabled={
                      draftBlocked ||
                      !reason.trim() ||
                      (overrideEnabled && reason.trim().length < 4) ||
                      (operation === 'REPLACE' &&
                        (!positionId ||
                          (source.termParticipation !== null &&
                            (!termConfirmed || termEvidence.trim().length < 4))))
                    }
                    onClick={() => void preview()}
                  >
                    {busy ? 'Checking…' : 'Review correction'}
                  </Button>
                ) : (
                  <section
                    className="space-y-4 rounded-lg border border-border p-4"
                    aria-label="Correction confirmation"
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <h3 className="mb-2 font-semibold">BEFORE</h3>
                        {source.status === 'REVOKED' ? award(null) : award(review.preview.before)}
                      </div>
                      <div>
                        <h3 className="mb-2 font-semibold">AFTER</h3>
                        {award(review.preview.after)}
                      </div>
                    </div>
                    <p className="text-sm">
                      <strong>Reason:</strong> {review.preview.reason}
                    </p>
                    {review.command.adminOverride ? (
                      <div className="space-y-3 border border-warning/30 bg-warning/5 p-3">
                        <h3 className="font-semibold">Administrator override advisories</h3>
                        {review.preview.warnings?.length ? (
                          <ul className="list-disc space-y-1 pl-5 text-sm">
                            {review.preview.warnings.map((warning) => (
                              <li key={warning.code}>{warning.message}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm">No policy deviations were found.</p>
                        )}
                        <Label className="flex min-h-11 items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            aria-label="I acknowledge correction override advisories"
                            checked={overrideAcknowledged}
                            disabled={draftBlocked}
                            onChange={(event) => setOverrideAcknowledged(event.target.checked)}
                          />
                          I reviewed the original award, corrected award, reason, and all
                          advisories. Record this administrator override.
                        </Label>
                      </div>
                    ) : null}
                    <div>
                      <h3 className="font-semibold">Constraint effects</h3>
                      {review.preview.constraintEffects === null ? (
                        <p className="text-sm">
                          Detailed capacity totals were not included in this preview.
                        </p>
                      ) : review.preview.constraintEffects.length === 0 ? (
                        <p className="text-sm">No A-Day capacity totals change.</p>
                      ) : (
                        <ul className="text-sm">
                          {review.preview.constraintEffects.map((entry) => (
                            <li key={entry.group}>
                              {entry.group}: {entry.before} → {entry.after}
                            </li>
                          ))}
                        </ul>
                      )}
                      {review.preview.validated ? (
                        <p className="mt-2 text-sm">
                          Checks passed: {review.preview.validated.join(', ')}.
                        </p>
                      ) : null}
                    </div>
                    <Button
                      disabled={
                        draftBlocked ||
                        (review.command.adminOverride !== undefined && !overrideAcknowledged)
                      }
                      onClick={() => void confirm()}
                    >
                      {busy ? 'Recording…' : 'Confirm correction'}
                    </Button>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </TaskPanel>
    </>
  );
}
