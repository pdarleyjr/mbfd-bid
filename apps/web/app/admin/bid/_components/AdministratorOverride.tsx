'use client';

import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { ADayGroupIdSchema, WeekdaySchema } from '@mbfd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MemberLite, PositionMeta } from '../../../_components/bid/types';
import { PreviousBidInfo } from './BidMemberPanel';
import { useBidOperator } from './BidOperatorContext';

type Warning = { code: string; message: string };
type OverridePreview = {
  valid: true;
  expectedSeq: number;
  scoreReceiptSha256: string | null;
  warnings: Warning[];
  memberId: number;
  positionId?: string;
  nextMemberId: number | null;
  deferredMemberIds?: number[];
  deferredStageId?: string;
};
type Action = 'AWARD' | 'A_DAY' | 'DUTY' | 'SKIP' | 'DEFER' | 'DEFER_STAGE';
type Draft = {
  action: Action;
  memberId: number | null;
  positionId: string;
  aDay: string;
  reason: string;
  forced: boolean;
  deferADay: boolean;
  roleLabel: string;
  termConfirmed: boolean;
  termEvidence: string;
};

interface Props {
  compact?: boolean;
  bidSessionId: string;
  allowed: boolean;
  memberIds: readonly number[];
  positionIds: readonly string[];
  opportunityPools:
    | readonly { id: string; positionIds: string[]; resolvedPositionId: string | null }[]
    | undefined;
  members: Record<string, MemberLite>;
  positions: readonly PositionMeta[];
  fills: Record<string, { member_id: number; a_day?: string | null }>;
  nonBiddablePositions?: readonly { position_id: string; label: string }[] | undefined;
  onChooseTask?: ((task: 'correction' | 'order' | 'exceptional') => void) | undefined;
  sequence: number;
  currentMemberId: number | null;
  currentStage: string | undefined;
  currentStageId: string | undefined;
  combatGroups?: readonly string[] | undefined;
  aDayTiming: Record<string, 'SIMULTANEOUS' | 'AFTER_POSITION_SELECTION'> | undefined;
  defaultADayTiming: 'SIMULTANEOUS' | 'AFTER_POSITION_SELECTION' | null | undefined;
  termParticipation: Record<string, { assignmentId: string; sourceRef?: string }> | undefined;
  commandsBlocked: boolean;
  onCanonicalChange: () => void;
}

function failureMessage(code: string | undefined) {
  if (code === 'STALE_SEQUENCE' || code === 'SEQUENCE_CONFLICT' || code === 'STALE_SCORE_REFERENCE')
    return 'The bid changed. Review the latest availability and preview this action again.';
  if (code?.includes('OCCUPIED') || code?.includes('FILLED'))
    return 'This position is already filled. Use Correct Bid to review its recorded award.';
  if (code?.includes('ALREADY') || code?.includes('DUPLICATE'))
    return 'This member already has a recorded award. Use Correct Bid to change that award.';
  if (code?.includes('WARNING') || code?.includes('ACKNOWLEDG'))
    return 'The advisories changed. Preview this action again and acknowledge the current advisories.';
  if (code?.includes('FORBIDDEN') || code?.includes('AUTHORITY'))
    return 'Your account does not have administrator override authority for this bid.';
  if (code?.includes('A_DAY'))
    return 'Choose a valid A-Day group or R-Day for this position, then preview again.';
  if (code === 'operator_sign_in_required' || code === 'operator_step_up_required')
    return 'Renew your operator sign-in, then review your retained draft before confirming.';
  return 'This action could not be recorded. Refresh the bid and review the selected member, position, and advisories.';
}

/** Explicit review and acknowledgement keep every policy override intentional and auditable. */
export function AdministratorOverride(props: Props) {
  const operator = useBidOperator();
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    action: 'AWARD',
    memberId: null,
    positionId: '',
    aDay: '',
    reason: '',
    forced: false,
    deferADay: false,
    roleLabel: '',
    termConfirmed: false,
    termEvidence: '',
  });
  const [review, setReview] = useState<{
    fingerprint: string;
    preview: OverridePreview;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const requestGeneration = useRef(0);
  const handledOverrideIntent = useRef(0);
  const [memberQuery, setMemberQuery] = useState('');
  const [positionQuery, setPositionQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [rankFilter, setRankFilter] = useState('');
  useEffect(() => {
    const intent = operator?.overrideIntent;
    if (!props.allowed || !intent || handledOverrideIntent.current >= intent.nonce) return;
    handledOverrideIntent.current = intent.nonce;
    requestGeneration.current += 1;
    setDraft((current) => ({
      ...current,
      action: 'AWARD',
      memberId: intent.memberId,
      positionId: intent.positionId ?? '',
      aDay: '',
      termConfirmed: false,
      termEvidence: '',
      deferADay: intent.deferADay === true,
    }));
    setReview(null);
    setAcknowledged(false);
    setNotice(null);
    setOpen(true);
  }, [operator?.overrideIntent, props.allowed]);
  const memberIds = [...new Set(props.memberIds)].filter((id) => props.members[String(id)]);
  const selectedMember = draft.memberId === null ? null : props.members[String(draft.memberId)];
  const assignedPosition = Object.entries(props.fills).find(
    ([, fill]) => fill.member_id === draft.memberId,
  )?.[0];
  const selectedPosition = props.positions.find(
    (position) => position.id === (draft.action === 'A_DAY' ? assignedPosition : draft.positionId),
  );
  const termRight =
    draft.memberId === null ? undefined : props.termParticipation?.[String(draft.memberId)];
  const selectedPool = props.opportunityPools?.find(
    (pool) =>
      pool.resolvedPositionId === draft.positionId && pool.positionIds.includes(draft.positionId),
  );
  const positionOptions = props.positions.filter(
    (position) =>
      (!position.bidParticipation || position.bidParticipation === 'BIDDABLE') &&
      props.positionIds.includes(position.id) &&
      props.fills[position.id] === undefined,
  );
  const filteredMembers = memberIds.filter((id) => {
    const member = props.members[String(id)];
    return (
      id === draft.memberId ||
      (member &&
        `${member.rank} ${member.firstName} ${member.lastName} ${member.employeeId}`
          .toLowerCase()
          .includes(memberQuery.trim().toLowerCase()))
    );
  });
  const filteredPositions = positionOptions.filter(
    (position) =>
      position.id === draft.positionId ||
      ((!shiftFilter || position.shift === shiftFilter) &&
        (!rankFilter || position.rankRequired === rankFilter) &&
        `${position.id} ${position.station} ${position.unit} ${position.positionName}`
          .toLowerCase()
          .includes(positionQuery.trim().toLowerCase())),
  );
  const requiresADay =
    draft.action === 'AWARD' &&
    (props.aDayTiming?.[draft.positionId] ?? props.defaultADayTiming) != null;
  const groups: readonly string[] =
    selectedPosition?.shift === 'D' ? WeekdaySchema.options : ADayGroupIdSchema.options;
  const fingerprint = JSON.stringify([
    props.bidSessionId,
    props.sequence,
    draft,
    termRight?.assignmentId,
    selectedPool?.id,
  ]);
  const reviewed = review?.fingerprint === fingerprint ? review.preview : null;
  const draftRef = useRef(fingerprint);
  draftRef.current = fingerprint;
  const canPreview =
    props.allowed &&
    !props.commandsBlocked &&
    !busy &&
    draft.memberId !== null &&
    memberIds.includes(draft.memberId) &&
    draft.reason.trim().length <= 500 &&
    (draft.action !== 'AWARD' || !assignedPosition) &&
    (draft.action !== 'A_DAY' || (assignedPosition !== undefined && groups.includes(draft.aDay))) &&
    (draft.action !== 'DUTY' ||
      (draft.roleLabel.trim().length >= 4 &&
        (!draft.positionId ||
          props.nonBiddablePositions?.some(
            (position) => position.position_id === draft.positionId,
          )))) &&
    (draft.action !== 'DEFER_STAGE' || props.currentStageId !== undefined) &&
    (draft.action !== 'AWARD' ||
      (selectedPosition !== undefined &&
        props.positionIds.includes(draft.positionId) &&
        props.fills[draft.positionId] === undefined &&
        (!termRight || (draft.termConfirmed && draft.termEvidence.trim().length >= 4)) &&
        (!requiresADay || draft.deferADay || groups.includes(draft.aDay))));

  function change(next: Partial<Draft>) {
    requestGeneration.current += 1;
    setDraft((current) => ({ ...current, ...next }));
    setReview(null);
    setAcknowledged(false);
    setNotice(null);
  }

  function memberName(id: number) {
    const member = props.members[String(id)];
    return member ? `${member.rank} ${member.firstName} ${member.lastName}`.trim() : `Member ${id}`;
  }

  function commandBody(
    commandId: string,
    warningCodes: string[],
    expectedScoreReceiptSha256?: string | null,
  ) {
    return {
      v: 1,
      type:
        draft.action === 'AWARD'
          ? 'live.record_selection'
          : draft.action === 'A_DAY'
            ? 'live.record_a_day'
            : draft.action === 'DUTY'
              ? 'live.set_exceptional_assignment'
              : 'live.disposition',
      commandId,
      expectedSeq: props.sequence,
      ...(expectedScoreReceiptSha256 !== undefined ? { expectedScoreReceiptSha256 } : {}),
      reason: draft.reason.trim(),
      evidenceReference: null,
      memberId: draft.memberId,
      ...(draft.action === 'AWARD'
        ? {
            positionId: draft.positionId,
            ...(draft.forced ? { forced: true } : {}),
            ...(requiresADay && !draft.deferADay ? { aDay: draft.aDay } : {}),
            ...(selectedPool ? { pool: { poolId: selectedPool.id } } : {}),
          }
        : draft.action === 'A_DAY'
          ? { aDay: draft.aDay }
          : draft.action === 'DUTY'
            ? {
                operation: 'ASSIGN',
                roleLabel: draft.roleLabel.trim(),
                ...(draft.positionId ? { positionId: draft.positionId } : {}),
              }
            : {
                disposition: draft.action === 'DEFER_STAGE' ? 'DEFER' : draft.action,
                ...(draft.action === 'DEFER_STAGE' ? { deferStageId: props.currentStageId } : {}),
              }),
      adminOverride: { acknowledged: true, warningCodes },
      ...(draft.action === 'AWARD' && termRight
        ? {
            termDeparture: {
              assignmentId: termRight.assignmentId,
              memberConfirmed: true,
              evidenceReference: draft.termEvidence.trim(),
            },
          }
        : {}),
    };
  }

  async function preview() {
    if (!canPreview) return;
    const generation = ++requestGeneration.current;
    const submittedFingerprint = fingerprint;
    setBusy(true);
    setReview(null);
    setAcknowledged(false);
    setNotice(null);
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${encodeURIComponent(props.bidSessionId)}/commands/live/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commandBody(crypto.randomUUID(), [])),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | (OverridePreview & { code?: string; error?: string })
        | null;
      if (generation !== requestGeneration.current || draftRef.current !== submittedFingerprint)
        return;
      if (!response.ok || body?.valid !== true)
        throw new Error(failureMessage(body?.code ?? body?.error));
      if (
        body.expectedSeq !== props.sequence ||
        body.memberId !== draft.memberId ||
        (draft.action === 'AWARD' && body.positionId !== draft.positionId) ||
        (draft.action === 'A_DAY' && body.positionId !== assignedPosition) ||
        (draft.action === 'DUTY' && draft.positionId && body.positionId !== draft.positionId) ||
        (draft.action === 'DEFER_STAGE' &&
          (body.deferredStageId !== props.currentStageId ||
            !Array.isArray(body.deferredMemberIds))) ||
        !Array.isArray(body.warnings) ||
        body.warnings.some(
          (warning) => typeof warning.code !== 'string' || typeof warning.message !== 'string',
        )
      )
        throw new Error('The preview does not match your action. Refresh and preview again.');
      setReview({ fingerprint: submittedFingerprint, preview: body });
    } catch (error) {
      if (generation === requestGeneration.current)
        setNotice(error instanceof Error ? error.message : 'The preview is unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!canPreview || reviewed === null || !acknowledged) return;
    const body = commandBody(
      '',
      reviewed.warnings.map((warning) => warning.code),
      reviewed.scoreReceiptSha256 ?? null,
    );
    const commandFingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== commandFingerprint)
      pending.current = { fingerprint: commandFingerprint, commandId: crypto.randomUUID() };
    body.commandId = pending.current.commandId;
    setBusy(true);
    setNotice(null);
    try {
      const response = await csrfFetch(
        `/api/admin/bid-session/${encodeURIComponent(props.bidSessionId)}/commands/live`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        kind?: string;
        code?: string;
        error?: string;
      } | null;
      if (result?.kind === 'rejected') pending.current = null;
      if (!response.ok || result?.kind !== 'accepted')
        throw new Error(failureMessage(result?.code ?? result?.error));
      pending.current = null;
      requestGeneration.current += 1;
      setReview(null);
      setAcknowledged(false);
      setDraft((current) => ({
        ...current,
        positionId: '',
        aDay: '',
        reason: '',
        forced: false,
        deferADay: false,
        roleLabel: '',
        termConfirmed: false,
        termEvidence: '',
      }));
      setNotice(
        draft.action === 'AWARD'
          ? draft.forced
            ? 'Forced assignment recorded and marked in the bid. Review the refreshed state before another action.'
            : 'Selection saved.'
          : draft.action === 'A_DAY'
            ? 'A-Day saved.'
            : draft.action === 'DUTY'
              ? 'Temporary duty saved.'
              : draft.action === 'DEFER_STAGE'
                ? 'Current step deferred. Its unawarded turns remain pending for later selection.'
                : 'Member skipped for now. Their unawarded selection rights remain pending.',
      );
      props.onCanonicalChange();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The action could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  if (!props.allowed) return null;
  return (
    <div className={props.compact ? '' : 'mb-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={props.commandsBlocked || busy}
          onClick={() => {
            const initialMemberId = operator?.selectedMemberId ?? props.currentMemberId;
            change({
              memberId: initialMemberId,
              positionId: '',
              aDay: '',
              termConfirmed: false,
              termEvidence: '',
            });
            setOpen(true);
          }}
        >
          Adjust bid
        </Button>
      </div>
      <TaskPanel
        open={open}
        onClose={() => {
          requestGeneration.current += 1;
          setOpen(false);
        }}
        title="Adjust bid"
        description="Choose an action, review the advisories, then confirm."
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Normal order:{' '}
            {props.currentMemberId === null
              ? 'No current bidder'
              : memberName(props.currentMemberId)}
            {props.currentStage ? ` · ${props.currentStage}` : ''}.
          </p>
          {props.onChooseTask ? (
            <nav aria-label="Other bid adjustments" className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onChooseTask?.('correction');
                }}
              >
                Change or remove an award
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onChooseTask?.('order');
                }}
              >
                Change bid order
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onChooseTask?.('exceptional');
                }}
              >
                Manage temporary duties
              </Button>
            </nav>
          ) : null}
          <Label className="block">
            Action
            <NativeSelect
              aria-label="Administrator override action"
              value={draft.action}
              disabled={busy}
              onChange={(event) =>
                change({
                  action: event.target.value as Action,
                  positionId: '',
                  aDay: '',
                  ...(event.target.value === 'DEFER_STAGE'
                    ? { memberId: props.currentMemberId }
                    : {}),
                })
              }
            >
              <option value="AWARD">Assign an open seat</option>
              <option value="A_DAY">Set or change A-Day</option>
              <option value="DUTY">Assign temporary duty</option>
              <option value="SKIP">Skip member for now</option>
              <option value="DEFER">Defer member for later</option>
              {props.currentStageId ? (
                <option value="DEFER_STAGE">Bypass current step · keep its picks pending</option>
              ) : null}
            </NativeSelect>
          </Label>
          {draft.action !== 'DEFER_STAGE' ? (
            <Label className="block">
              Find member
              <Input
                aria-label="Find override member"
                value={memberQuery}
                disabled={busy}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="Name, rank or employee number"
              />
            </Label>
          ) : null}
          <Label className="block">
            {draft.action === 'DEFER_STAGE' ? 'Current member' : 'Member'}
            <NativeSelect
              aria-label="Administrator override member"
              value={draft.memberId ?? ''}
              disabled={busy || draft.action === 'DEFER_STAGE'}
              onChange={(event) => {
                const id = event.target.value ? Number(event.target.value) : null;
                change({
                  memberId: id,
                  positionId: '',
                  aDay: '',
                  termConfirmed: false,
                  termEvidence: '',
                });
                if (id !== null) operator?.selectMember(id);
              }}
            >
              <option value="">Choose a member</option>
              {filteredMembers.map((id) => (
                <option key={id} value={id}>
                  {memberName(id)}
                  {Object.values(props.fills).some((fill) => fill.member_id === id)
                    ? ' · Awarded'
                    : ''}
                </option>
              ))}
            </NativeSelect>
          </Label>
          {assignedPosition && draft.action === 'AWARD' ? (
            <p role="alert" className="text-sm text-warning">
              This member holds {assignedPosition}. Choose “Change or remove an award” above to move
              them.
            </p>
          ) : null}
          {selectedMember ? (
            <p className="text-sm">
              <strong>{memberName(selectedMember.id)}</strong> · {selectedMember.employeeId}
            </p>
          ) : null}
          {selectedMember ? <PreviousBidInfo member={selectedMember} /> : null}
          {draft.action === 'AWARD' && termRight ? (
            <fieldset className="space-y-3 border border-warning/40 p-3">
              <legend className="font-semibold">Voluntary departure from a term assignment</legend>
              <p className="text-sm">
                This member must explicitly choose to leave their current term assignment. An
                administrator override does not supply that consent.
              </p>
              <Label className="flex min-h-11 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  aria-label="Member confirms voluntary term departure"
                  checked={draft.termConfirmed}
                  disabled={busy}
                  onChange={(event) => change({ termConfirmed: event.target.checked })}
                />
                Member explicitly chose to leave the current term assignment.
              </Label>
              <Label className="block">
                Voluntary departure evidence
                <Input
                  aria-label="Voluntary departure evidence"
                  value={draft.termEvidence}
                  disabled={busy}
                  onChange={(event) => change({ termEvidence: event.target.value })}
                />
              </Label>
              {termRight.sourceRef ? (
                <p className="text-xs text-muted-foreground">
                  Reviewed term source: {termRight.sourceRef}
                </p>
              ) : null}
            </fieldset>
          ) : null}
          {draft.action === 'AWARD' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Label className="block">
                  Shift
                  <NativeSelect
                    aria-label="Override position shift"
                    value={shiftFilter}
                    disabled={busy}
                    onChange={(event) => setShiftFilter(event.target.value)}
                  >
                    <option value="">All shifts</option>
                    {[...new Set(positionOptions.map((position) => position.shift))].map(
                      (shift) => (
                        <option key={shift} value={shift}>
                          {shift === 'D' ? 'Days' : `${shift} shift`}
                        </option>
                      ),
                    )}
                  </NativeSelect>
                </Label>
                <Label className="block">
                  Position rank
                  <NativeSelect
                    aria-label="Override position rank"
                    value={rankFilter}
                    disabled={busy}
                    onChange={(event) => setRankFilter(event.target.value)}
                  >
                    <option value="">All ranks</option>
                    {[...new Set(positionOptions.map((position) => position.rankRequired))].map(
                      (rank) => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ),
                    )}
                  </NativeSelect>
                </Label>
              </div>
              <Label className="block">
                Find open position
                <Input
                  aria-label="Find override position"
                  value={positionQuery}
                  disabled={busy}
                  onChange={(event) => setPositionQuery(event.target.value)}
                  placeholder="Position, station or unit"
                />
              </Label>
              <Label className="block">
                Open position · all shifts and ranks
                <NativeSelect
                  aria-label="Administrator override open position"
                  value={draft.positionId}
                  disabled={busy}
                  onChange={(event) => change({ positionId: event.target.value, aDay: '' })}
                >
                  <option value="">Choose an open position</option>
                  {filteredPositions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.id} · {position.shift === 'D' ? 'Days' : `${position.shift} shift`}{' '}
                      · {position.rankRequired} · {position.unit} · {position.positionName}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
              {requiresADay && selectedPosition ? (
                <>
                  <Label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label="Pick A-Day later"
                      checked={draft.deferADay}
                      disabled={busy}
                      onChange={(event) => change({ deferADay: event.target.checked, aDay: '' })}
                    />
                    Pick A-Day later
                  </Label>
                  {!draft.deferADay ? (
                    <Label className="block">
                      {selectedPosition.shift === 'D' ? 'R-Day' : 'A-Day group'}
                      <NativeSelect
                        aria-label="Administrator override A-Day"
                        value={draft.aDay}
                        disabled={busy}
                        onChange={(event) => change({ aDay: event.target.value })}
                      >
                        <option value="">
                          Choose {selectedPosition.shift === 'D' ? 'R-Day' : 'A-Day group'}
                        </option>
                        {groups.map((group) => (
                          <option key={group} value={group}>
                            {group.startsWith('G') ? `Group ${group.slice(1)}` : group}
                          </option>
                        ))}
                      </NativeSelect>
                    </Label>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      The seat is saved now. A-Day remains due and the software prompts when this
                      member is up.
                    </p>
                  )}
                </>
              ) : null}
            </>
          ) : draft.action === 'A_DAY' ? (
            <div className="space-y-2">
              <p className="text-sm">
                {assignedPosition
                  ? `Recorded seat: ${assignedPosition}`
                  : 'Choose a member with a recorded seat.'}
              </p>
              {selectedPosition ? (
                <Label className="block">
                  {selectedPosition.shift === 'D' ? 'R-Day' : 'A-Day group'}
                  <NativeSelect
                    aria-label="Administrator override A-Day"
                    value={draft.aDay}
                    disabled={busy}
                    onChange={(event) => change({ aDay: event.target.value })}
                  >
                    <option value="">
                      Choose {selectedPosition.shift === 'D' ? 'R-Day' : 'A-Day group'}
                    </option>
                    {groups.map((group) => (
                      <option key={group} value={group}>
                        {group.startsWith('G') ? `Group ${group.slice(1)}` : group}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
              ) : null}
            </div>
          ) : draft.action === 'DUTY' ? (
            <div className="space-y-3">
              {assignedPosition ? (
                <p className="text-sm text-warning">
                  Existing seat {assignedPosition} stays assigned. Remove it first if the temporary
                  duty replaces that seat.
                </p>
              ) : null}
              <Label className="block">
                Duty / acting role
                <Input
                  aria-label="Adjustment duty label"
                  value={draft.roleLabel}
                  disabled={busy}
                  placeholder="Enter the directed duty"
                  onChange={(event) => change({ roleLabel: event.target.value })}
                />
              </Label>
              <details>
                <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
                  Link a closed position (optional)
                </summary>
                <NativeSelect
                  aria-label="Adjustment closed role"
                  value={draft.positionId}
                  disabled={busy}
                  onChange={(event) => change({ positionId: event.target.value })}
                >
                  <option value="">Custom duty</option>
                  {props.nonBiddablePositions?.map((position) => (
                    <option key={position.position_id} value={position.position_id}>
                      {position.position_id} · {position.label}
                    </option>
                  ))}
                </NativeSelect>
              </details>
            </div>
          ) : (
            <p className="text-sm">
              {draft.action === 'DEFER_STAGE'
                ? `Bypass ${props.currentStage ?? 'the current step'} now. Its unawarded turns move to the end and remain pending; this records no award and forfeits nobody’s selection rights.`
                : 'This records no award. The member retains their selection rights and remains visible in the pending members list.'}
            </p>
          )}
          <Label className="block">
            Note (optional)
            <Input
              aria-label="Note (optional)"
              value={draft.reason}
              maxLength={500}
              disabled={busy}
              onChange={(event) => change({ reason: event.target.value })}
              placeholder="Add context if helpful"
            />
          </Label>
          {draft.action === 'AWARD' ? (
            <Label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Mark as forced assignment"
                className="mt-1 size-4"
                checked={draft.forced}
                disabled={busy}
                onChange={(event) => change({ forced: event.target.checked })}
              />
              Mark as forced assignment
            </Label>
          ) : null}
          <Button type="button" disabled={!canPreview} onClick={() => void preview()}>
            {busy ? 'Checking…' : 'Review adjustment'}
          </Button>
          {review && reviewed === null ? (
            <p role="alert" className="text-sm text-warning">
              The bid or your draft changed. Review the override again before confirming.
            </p>
          ) : null}
          {reviewed ? (
            <section
              aria-label="Administrator override review"
              className="space-y-3 border border-warning/40 p-3"
            >
              <h3 className="font-semibold">Review before recording</h3>
              <p className="text-sm">
                {draft.action === 'DEFER_STAGE' ? (
                  `Bypass ${props.currentStage ?? 'current step'} · ${reviewed.deferredMemberIds?.length ?? 0} turns remain pending`
                ) : (
                  <>
                    {draft.action === 'A_DAY'
                      ? 'A-Day'
                      : draft.action === 'DUTY'
                        ? 'Temporary duty'
                        : draft.action === 'AWARD'
                          ? draft.forced
                            ? 'Forced award'
                            : 'Award'
                          : 'Skip for now'}{' '}
                    <strong>{memberName(reviewed.memberId)}</strong>
                    {draft.action === 'AWARD' || draft.action === 'A_DAY'
                      ? ` → ${reviewed.positionId}${draft.deferADay ? ' · A-Day later' : draft.aDay ? ` · ${draft.aDay.startsWith('G') ? `Group ${draft.aDay.slice(1)}` : draft.aDay}` : ''}`
                      : draft.action === 'DUTY'
                        ? ` → ${draft.roleLabel}`
                        : ''}
                  </>
                )}
                .
              </p>
              {reviewed.warnings.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {reviewed.warnings.map((warning) => (
                    <li key={warning.code}>{warning.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm">No policy deviations were found for this action.</p>
              )}
              <p className="text-sm">
                Next in ordinary order:{' '}
                {reviewed.nextMemberId === null
                  ? 'No remaining ordinary turn'
                  : memberName(reviewed.nextMemberId)}
                .
              </p>
              <Label className="flex min-h-11 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  aria-label="I acknowledge the override advisories"
                  checked={acknowledged}
                  disabled={busy || props.commandsBlocked}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I reviewed the adjustment and advisories.
              </Label>
              <Button
                type="button"
                disabled={!canPreview || !acknowledged}
                onClick={() => void confirm()}
              >
                {draft.action === 'A_DAY'
                  ? 'Confirm A-Day adjustment'
                  : draft.action === 'DUTY'
                    ? 'Confirm temporary duty'
                    : draft.action === 'AWARD'
                      ? 'Confirm administrator selection'
                      : draft.action === 'DEFER_STAGE'
                        ? 'Confirm bypass current step'
                        : 'Confirm skip for now'}
              </Button>
            </section>
          ) : null}
          {notice ? <output className="block text-sm">{notice}</output> : null}
        </div>
      </TaskPanel>
    </div>
  );
}
