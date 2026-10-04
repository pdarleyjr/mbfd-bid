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
import { OPERATOR_AUTH_REFRESHED, OPERATOR_REAUTH_STARTED } from '@/lib/operator-step-up';
import { ADayGroupIdSchema, WeekdaySchema } from '@mbfd/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MemberLite, PositionMeta } from '../../../_components/bid/types';
import { AdministratorOverride } from './AdministratorOverride';
import { useBidOperator } from './BidOperatorContext';
import { CorrectBid } from './CorrectBid';
import { ReviewedBidAdjustment } from './ReviewedBidAdjustment';
import { SessionPresentationLink } from './SessionPresentationLink';

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
type SelectionReview = {
  sequence: number;
  status: 'READY' | 'INELIGIBLE' | 'HIGHER_PRIORITY' | 'ADVISORY_HIGHER_PRIORITY' | 'NOT_CURRENT';
  selection_review: {
    member_id: number;
    position_id: string;
    specialty_id: string | null;
    mode?: 'ADVISORY' | undefined;
    specialty_label: string;
    higher_priority_candidates: Candidate[];
    eligible_related_position_ids: string[];
    a_day_timing: 'ORDINARY_TURN' | 'ADMIN_REVIEW';
  } | null;
};
type FallbackReview = {
  pool?: { poolId: string } | null;
  positionId: string;
  policyId: string;
  label: string;
  sourceRef: string;
  exhausted?: Array<{ tierId: string; eligibleMemberIds: number[]; reason: string }>;
} & (
  | { ok: false; code: string; blockingMemberIds?: number[] }
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
  admin_override_allowed?: boolean;
  admin_override_member_ids?: number[];
  admin_override_position_ids?: string[];
  specialty_review_position_ids?: string[];
  exceptional_assignments?: Array<{
    assignment_id: string;
    member_id: number;
    role_label: string;
    position_id: string | null;
    assigned_at_ms: number;
    forced: true;
  }>;
  available_non_biddable_positions?: Array<{ position_id: string; label: string }>;
  membership_distributions?: Array<{
    id: string;
    label: string;
    membershipSource: 'REVIEWED_EXISTING_MEMBERS' | 'REVIEWED_QUALIFIED_POOL';
    memberIds: number[];
    sourceRef: string;
    shifts: Array<'A' | 'B' | 'C'>;
    minimumPerShift: number;
    maximumPerShift: number;
    maximumPerADay: number;
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
  current_phase?: 'config' | 'position_bid' | 'a_day_bid' | 'paused' | 'complete';
  finalization_ready?: boolean;
  a_day_selection?: 'SIMULTANEOUS' | 'AFTER_POSITION_SELECTION' | null;
  a_day_timing_by_position?: Record<string, 'SIMULTANEOUS' | 'AFTER_POSITION_SELECTION'>;
  a_day_combat_groups?: readonly ('G1' | 'G2' | 'G3' | 'G4')[];
  a_day_scoped_constraints?: Array<{
    id: string;
    label: string;
    maximum: number;
    memberIds: number[];
    positionIds: string[];
    ranks: string[];
    shifts?: Array<'A' | 'B' | 'C' | 'D'>;
  }>;
  a_day_current?: {
    member_id: number;
    position_id: string;
    shift: 'A' | 'B' | 'C' | 'D';
    eligible_a_days: readonly string[];
  } | null;
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
  selection_stage?: {
    id: string;
    label: string;
    opportunity_position_ids: string[];
    eligible_position_ids: string[];
    all_opportunities_filled: boolean;
    next_stage: { id: string; label: string } | null;
  } | null;
  amendable_selection?: {
    from_position_id: string;
    member_id: number;
    opportunity_position_ids: string[];
    eligible_position_ids: string[];
  } | null;
  dispositions?: Array<{
    disposition: 'HOLD' | 'PASS' | 'DEFER' | 'SKIP' | 'DECLINED' | 'UNREACHABLE';
    advances: boolean;
    returns: boolean;
    retainsLaterSelectionRights: boolean;
    terminal: boolean;
    requiresReason: boolean;
    requiresEvidence: boolean;
  }>;
  unresolved_members?: Candidate[];
  completion_blockers?: Candidate[];
  returning_member?: Candidate | null;
  remaining_order: number[];
  remaining_turns?: Array<{
    memberId: number;
    stageId: string | null;
    stage_label?: string | null;
  }>;
  fills: Record<string, { member_id: number; a_day?: string | null; membership_ids?: string[] }>;
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
    eligible_position_ids?: string[];
    suspended_turn: boolean;
    resume: { member_id: number; queue_cursor: number; current_phase: string };
  };
  credential_coverage?: {
    availability: 'AVAILABLE' | 'UNAVAILABLE';
    source: 'FROZEN_SESSION_SNAPSHOT';
    groups?: Array<{
      id: string;
      label: string;
      remaining_seat_count: number;
      eligible_member_ids: number[];
      eligible_member_count: number;
      buffer: number;
      status: 'FEASIBLE' | 'LOW_BUFFER' | 'SHORTAGE';
      critical_member_ids: number[];
    }>;
    code?: string;
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

type RemainingOrderEntry = {
  memberId: number;
  occurrence: number;
  stageId?: string | null;
  stage_label?: string | null;
};

function remainingOrderEntries(
  turns: Array<number | { memberId: number; stageId?: string | null; stage_label?: string | null }>,
): RemainingOrderEntry[] {
  const counts = new Map<number, number>();
  return turns.map((turn) => {
    const memberId = typeof turn === 'number' ? turn : turn.memberId;
    const occurrence = counts.get(memberId) ?? 0;
    counts.set(memberId, occurrence + 1);
    return { ...(typeof turn === 'number' ? { memberId } : turn), occurrence };
  });
}

interface Props {
  bidSessionId: string;
  isMock: boolean;
  currentBidderId: number | null;
  bidOrder: Array<{ memberId: number }>;
  fills: Record<string, { memberId: number }>;
  members: Record<string, MemberLite>;
  positions?: readonly PositionMeta[] | undefined;
  onCanonicalChange?: (() => void) | undefined;
  workspace?: boolean;
  board?: ReactNode;
  onWorkspaceStateChange?:
    | ((state: {
        aDayPendingMemberIds: number[];
        aDayDueMemberIds: number[];
        temporarilyAssignedMemberIds: number[];
      }) => void)
    | undefined;
}

function name(candidate: Candidate): string {
  return `${candidate.rank ?? ''} ${candidate.first_name} ${candidate.last_name}`.trim();
}

function aDayOptions(
  position: PositionMeta | undefined,
  shift?: 'A' | 'B' | 'C' | 'D',
  combatGroups?: readonly string[],
): readonly string[] {
  const effectiveShift = position?.shift ?? shift;
  if (effectiveShift === 'D') return WeekdaySchema.options;
  if (effectiveShift !== undefined) return combatGroups ?? ADayGroupIdSchema.options;
  return [];
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
  shift,
  combatGroups,
  value,
  onChange,
  unavailable,
}: {
  label: string;
  position: PositionMeta | undefined;
  shift?: 'A' | 'B' | 'C' | 'D';
  combatGroups?: readonly string[] | undefined;
  value: string;
  onChange: (value: string) => void;
  unavailable?: Readonly<Record<string, string>>;
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
        <option value="">{label.includes('R-Day') ? 'Select R-Day' : 'Select A-Day'}</option>
        {aDayOptions(position, shift, combatGroups).map((option) => (
          <option key={option} value={option} disabled={unavailable?.[option] !== undefined}>
            {option.replace(/^G(\d+)$/, 'Group $1')}
            {unavailable?.[option] ? ` — unavailable for ${unavailable[option]}` : ''}
          </option>
        ))}
      </NativeSelect>
      {Object.entries(unavailable ?? {}).map(([aDay, reason]) => (
        <span key={aDay} className="mt-1 block text-xs text-amber-800">
          {aDay} is unavailable because {reason}.
        </span>
      ))}
    </Label>
  );
}

function commandErrorMessage(
  body: { code?: string; error?: string } | null,
  status: number,
): string {
  const messages: Record<string, string> = {
    LIVE_STAGE_NOT_ELIGIBLE:
      'This opportunity is outside the bidder’s current stage. Choose an open opportunity shown for this stage.',
    SPECIALTY_HIGHER_PRIORITY_UNRESOLVED:
      'Other qualified members have priority for this specialty. Review them before confirming this selection.',
    live_specialty_no_higher_priority_candidate:
      'No higher-priority qualified candidate needs review for that seat. Use Record selection for the current bidder if the opportunity is eligible.',
    live_specialty_requester_position_ineligible:
      'The current bidder does not qualify for that specialty position under the saved Bid rules. Review their eligibility before continuing.',
    live_specialty_requester_missing:
      'No current bidder is available for a specialty request. Refresh the session and confirm the active turn.',
    live_specialty_evidence_date_missing:
      'The saved Bid version has no credential evidence date for this specialty review. Check the frozen version before continuing.',
    live_specialty_policy_missing:
      'This specialty is not in the saved Bid policy. Refresh the session and review its frozen version.',
    MEMBERSHIP_A_DAY_MAXIMUM_REACHED:
      'That A-Day is already assigned to the maximum number of members in this group on this shift.',
    MEMBERSHIP_SHIFT_MAXIMUM_REACHED:
      'That shift already has the maximum number of members in this group.',
    MEMBERSHIP_SHIFT_NOT_PERMITTED: 'This group is not permitted on the selected shift.',
    MEMBERSHIP_A_DAY_REQUIRED: 'Select an A-Day for this group before recording the award.',
    MEMBERSHIP_QUALIFICATION_EVIDENCE_REQUIRED:
      'This member does not have the frozen qualification evidence required for that group.',
    MEMBERSHIP_POOL_SELECTION_INVALID:
      'This member is not in the reviewed qualified pool for that group.',
    MEMBERSHIP_MULTIPLE_ASSIGNMENTS:
      'This member already has a group assignment in the canonical award set.',
    SCOPED_A_DAY_MAXIMUM:
      'That A-Day has reached a scoped staffing limit. Choose another available A-Day.',
  };
  const codeMessage = body?.code ? messages[body.code] : undefined;
  if (codeMessage) return codeMessage;
  const errorMessage = body?.error ? messages[body.error] : undefined;
  if (errorMessage) return errorMessage;
  return status === 409
    ? 'This action could not be recorded under the saved Bid policy. Refresh the session and review the current bidder, stage, and opportunity.'
    : `The action could not be recorded. Refresh the session and try again (${status}).`;
}

function SelectionFrame({
  inline,
  children,
  ...frame
}: {
  inline: boolean;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
}) {
  return inline ? (
    <div className="flex flex-col gap-3 border-t border-border pt-3" data-testid="selection-review">
      {children}
    </div>
  ) : (
    <TaskPanel {...frame}>{children}</TaskPanel>
  );
}

function OperatorNotes({ optional, children }: { optional: boolean; children: ReactNode }) {
  return optional ? (
    <details className="order-last border-t border-border pt-3">
      <summary className="cursor-pointer text-sm text-muted-foreground">Note (optional)</summary>
      <div className="mt-3">{children}</div>
    </details>
  ) : (
    <>{children}</>
  );
}

function CoverageDetails({
  compact,
  summary,
  children,
}: {
  compact: boolean;
  summary: string;
  children: ReactNode;
}) {
  return compact ? (
    <details className="order-2 min-w-0 rounded border border-warning/40 bg-warning/5 px-3">
      <summary
        className="min-h-11 cursor-pointer content-center text-sm font-medium"
        aria-live="polite"
        title={summary}
      >
        Alerts · {summary}
      </summary>
      <div className="absolute left-0 top-full z-30 mt-1 max-h-[50dvh] w-full max-w-lg overflow-y-auto rounded border border-border bg-card p-3 shadow-lg">
        {children}
      </div>
    </details>
  ) : (
    <>{children}</>
  );
}

export function AnnualLiveControls(props: Props) {
  const operator = useBidOperator();
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [state, setState] = useState<SpecialtyState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [authRefreshing, setAuthRefreshing] = useState(false);
  const [authReviewRequired, setAuthReviewRequired] = useState(false);
  const reauthBaseline = useRef<{ sequence: number | null } | null>(null);
  const [panel, setPanel] = useState<
    | 'selection'
    | 'disposition'
    | 'a-day'
    | 'specialty'
    | 'fallback'
    | 'presentation'
    | 'session'
    | 'amendment'
    | 'order'
    | 'finalization'
    | 'exceptional'
    | null
  >(null);
  const pendingCommand = useRef<{
    fingerprint: string;
    commandId: string;
    expectedSeq: number;
  } | null>(null);
  const lastLoadedSequence = useRef<number | null>(null);
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
  const [selectionReview, setSelectionReview] = useState<{
    identity: string;
    result: SelectionReview | null;
    error: string | null;
  } | null>(null);
  const [reviewRetry, setReviewRetry] = useState(0);
  const [specialtyAwardPositionId, setSpecialtyAwardPositionId] = useState('');
  const [actingMemberId, setActingMemberId] = useState('');
  const [actingMemberQuery, setActingMemberQuery] = useState('');
  const [actingRoleLabel, setActingRoleLabel] = useState('');
  const [actingPositionId, setActingPositionId] = useState('');
  const [actingConfirmed, setActingConfirmed] = useState(false);
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
  const aDayTimingForPosition = (positionId: string | undefined) =>
    positionId === undefined
      ? null
      : (state?.a_day_timing_by_position?.[positionId] ?? state?.a_day_selection ?? null);
  const requiresSimultaneousADay = (positionId: string | undefined) =>
    aDayTimingForPosition(positionId) === 'SIMULTANEOUS';
  // Only an early award defers its A-Day; an own-turn award selects both together.
  const requiresADayForAward = (positionId: string | undefined, memberId: unknown) =>
    requiresSimultaneousADay(positionId) ||
    (aDayTimingForPosition(positionId) === 'AFTER_POSITION_SELECTION' &&
      memberId !== undefined &&
      memberId !== null &&
      (memberId === state?.current_bidder?.member_id ||
        memberId === state?.returning_member?.member_id));
  const fallbackRequiresSimultaneousADay = requiresADayForAward(
    fallback?.positionId,
    fallbackMemberId,
  );
  const selectionMember = state?.returning_member ?? state?.current_bidder ?? null;
  const selectionMemberId = selectionMember?.member_id ?? null;
  const activeMemberId =
    state?.a_day_current?.member_id ?? state?.active?.current_candidate_id ?? selectionMemberId;
  const [availableShift, setAvailableShift] = useState('');
  const [correctionRequest, setCorrectionRequest] = useState(0);
  const handledIntent = useRef(0);
  const selectionOwner = useRef<number | null>(null);
  const loaded = state !== null;
  useEffect(() => {
    operator?.setOverrideAllowed(state?.admin_override_allowed === true);
  }, [state?.admin_override_allowed, operator?.setOverrideAllowed]);
  useEffect(() => {
    if (!props.workspace || !loaded) return;
    const previous = selectionOwner.current;
    selectionOwner.current = selectionMemberId;
    if (previous !== null && previous !== selectionMemberId) {
      setSelectionPositionId('');
      setSelectionPoolId('');
      setNotice(
        'The current bidder changed. Review their details and choose a position for this turn.',
      );
    }
  }, [props.workspace, loaded, selectionMemberId]);
  useEffect(() => {
    if (props.workspace && loaded) operator?.setActiveMember(activeMemberId);
  }, [props.workspace, loaded, activeMemberId, operator?.setActiveMember]);
  useEffect(() => {
    if (!props.workspace || state === null || !props.onWorkspaceStateChange) return;
    props.onWorkspaceStateChange({
      aDayPendingMemberIds: [
        ...new Set(
          Object.entries(state.fills)
            .filter(
              ([positionId, fill]) =>
                !fill.a_day &&
                (state.a_day_timing_by_position?.[positionId] ?? state.a_day_selection) != null,
            )
            .map(([, fill]) => fill.member_id),
        ),
      ],
      aDayDueMemberIds: state.a_day_current ? [state.a_day_current.member_id] : [],
      temporarilyAssignedMemberIds: [
        ...new Set((state.exceptional_assignments ?? []).map((assignment) => assignment.member_id)),
      ],
    });
  }, [props.workspace, state, props.onWorkspaceStateChange]);
  useEffect(() => {
    const intent = operator?.positionIntent;
    if (!props.workspace || !intent || state === null || handledIntent.current >= intent.nonce)
      return;
    handledIntent.current = intent.nonce;
    if (
      state.admin_override_allowed &&
      state.fills[intent.positionId] === undefined &&
      (intent.memberId !== selectionMemberId ||
        !state.selection_stage?.eligible_position_ids.includes(intent.positionId))
    ) {
      operator?.requestOverride(intent.positionId);
      return;
    }
    if (intent.memberId !== selectionMemberId) {
      setNotice('This member is not up now. Return to the current bidder to record a selection.');
      return;
    }
    if (
      state.fills[intent.positionId] !== undefined ||
      !state.selection_stage?.eligible_position_ids.includes(intent.positionId)
    ) {
      setNotice(
        'This position is not available to this member in the current stage. Choose one of the eligible openings shown here.',
      );
      return;
    }
    const pool = state.opportunity_pools?.find((entry) =>
      entry.positionIds.includes(intent.positionId),
    );
    if (pool && (!pool.valid || pool.resolvedPositionId === null)) {
      setNotice('This pool is unavailable. Review its current capacity before selecting.');
      return;
    }
    setSelectionPositionId(pool?.resolvedPositionId ?? intent.positionId);
    setSelectionPoolId(pool?.id ?? '');
    setPanel('selection');
    setNotice(null);
  }, [
    operator?.positionIntent,
    operator?.requestOverride,
    props.workspace,
    selectionMemberId,
    state,
  ]);
  const dispositionMember = selectionMember;
  const termMemberId =
    panel === 'selection'
      ? selectionMember?.member_id
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
    specialtyAwardPositionId,
  ]);
  const [termChoice, setTermChoice] = useState({ identity: '', confirmed: false, evidence: '' });
  const termConfirmed = termChoice.identity === termIdentity && termChoice.confirmed;
  const termEvidence = termChoice.identity === termIdentity ? termChoice.evidence : '';
  const selectionPosition = props.positions?.find(
    (position) => position.id === selectionPositionId,
  );
  const selectionUnavailableADays = useMemo(() => {
    const memberId = selectionMember?.member_id;
    const shift = selectionPosition?.shift;
    if (
      memberId === undefined ||
      selectionPosition === undefined ||
      shift === undefined ||
      shift === 'D'
    )
      return {};
    const unavailable: Record<string, string> = {};
    for (const distribution of state?.membership_distributions ?? []) {
      const applies =
        distribution.membershipSource === 'REVIEWED_EXISTING_MEMBERS'
          ? distribution.memberIds.includes(memberId)
          : membershipChoice.memberId === memberId &&
            membershipChoice.ids.includes(distribution.id);
      if (!applies || !distribution.shifts.includes(shift)) continue;
      const assigned = Object.entries(state?.fills ?? {}).flatMap(([positionId, fill]) => {
        const fillShift = props.positions?.find((position) => position.id === positionId)?.shift;
        const included =
          distribution.membershipSource === 'REVIEWED_EXISTING_MEMBERS'
            ? distribution.memberIds.includes(fill.member_id)
            : fill.membership_ids?.includes(distribution.id) === true;
        return included && fillShift === shift ? [fill] : [];
      });
      for (const aDay of aDayOptions(selectionPosition, undefined, state?.a_day_combat_groups)) {
        const reason =
          assigned.length >= distribution.maximumPerShift
            ? `${distribution.label} already has its maximum on ${shift} shift`
            : assigned.filter((fill) => fill.a_day === aDay).length >= distribution.maximumPerADay
              ? `${distribution.label} already has its maximum on ${shift} shift for that A-Day`
              : null;
        if (reason) unavailable[aDay] = reason;
      }
    }
    for (const constraint of state?.a_day_scoped_constraints ?? []) {
      if (constraint.shifts && !constraint.shifts.includes(shift)) continue;
      const matches = (candidateId: number, positionId: string) =>
        constraint.memberIds.includes(candidateId) ||
        constraint.positionIds.includes(positionId) ||
        constraint.ranks.includes(props.members[String(candidateId)]?.rank ?? '');
      if (!matches(memberId, selectionPosition.id)) continue;
      for (const aDay of aDayOptions(selectionPosition, undefined, state?.a_day_combat_groups)) {
        const assigned = Object.entries(state?.fills ?? {}).filter(
          ([positionId, fill]) =>
            props.positions?.find((position) => position.id === positionId)?.shift === shift &&
            fill.a_day === aDay &&
            matches(fill.member_id, positionId),
        ).length;
        if (assigned >= constraint.maximum) {
          unavailable[aDay] ??=
            `${constraint.label} already has its maximum on ${shift} shift for that A-Day`;
        }
      }
    }
    return unavailable;
  }, [
    membershipChoice,
    props.positions,
    props.members,
    selectionMember?.member_id,
    selectionPosition,
    state?.a_day_combat_groups,
    state?.a_day_scoped_constraints,
    state?.fills,
    state?.membership_distributions,
  ]);
  const selectionRequiresSimultaneousADay = requiresADayForAward(
    selectionPositionId,
    selectionMember?.member_id,
  );
  const amendmentPosition = props.positions?.find((position) => position.id === amendTo);
  const amendmentRequiresSimultaneousADay = requiresSimultaneousADay(amendTo);
  const effectiveSpecialtyAwardId =
    state?.active?.eligible_position_ids !== undefined
      ? specialtyAwardPositionId
      : state?.active?.requested_position_id;
  const specialtyPosition = props.positions?.find(
    (position) => position.id === effectiveSpecialtyAwardId,
  );
  const specialtyRequiresSimultaneousADay = requiresSimultaneousADay(effectiveSpecialtyAwardId);
  const [selectionADay, setSelectionADay] = useAwardADay(
    JSON.stringify([
      props.bidSessionId,
      selectionMember?.member_id,
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
      effectiveSpecialtyAwardId,
      state?.active?.current_candidate_id,
      specialtyPosition?.shift,
    ]),
  );
  const [deferredADay, setDeferredADay] = useAwardADay(
    JSON.stringify([
      props.bidSessionId,
      state?.sequence,
      state?.a_day_current?.member_id,
      state?.a_day_current?.position_id,
      state?.a_day_current?.shift,
    ]),
  );
  const pendingADay = state?.a_day_current ?? null;
  const promptIdentity = JSON.stringify([
    props.bidSessionId,
    state?.sequence,
    selectionMemberId,
    selectionPositionId,
    reviewRetry,
  ]);
  const needsSpecialtyReview =
    state?.active == null &&
    pendingADay === null &&
    selectionMemberId !== null &&
    (state?.specialty_review_position_ids?.includes(selectionPositionId) ||
      state?.specialties.some((specialty) =>
        specialty.positions.some((position) => position.id === selectionPositionId),
      )) === true;
  const prompt = selectionReview?.identity === promptIdentity ? selectionReview : null;
  const priorityReview = prompt?.result?.selection_review ?? null;
  const priorityAdvisory = prompt?.result?.status === 'ADVISORY_HIGHER_PRIORITY';
  const priorityReviewRequired =
    !priorityAdvisory && (priorityReview?.higher_priority_candidates.length ?? 0) > 0;
  useEffect(() => {
    if (!needsSpecialtyReview || selectionMemberId === null) {
      setSelectionReview(null);
      return;
    }
    let disposed = false;
    setSelectionReview({ identity: promptIdentity, result: null, error: null });
    void fetch(
      `/api/admin/bid-session/${encodeURIComponent(props.bidSessionId)}/specialty-review?member_id=${selectionMemberId}&position_id=${encodeURIComponent(selectionPositionId)}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Specialty priority could not be checked. Retry the review.');
        const result = (await response.json()) as SelectionReview;
        if (
          ![
            'READY',
            'HIGHER_PRIORITY',
            'ADVISORY_HIGHER_PRIORITY',
            'INELIGIBLE',
            'NOT_CURRENT',
          ].includes(result.status)
        )
          throw new Error('The specialty review response is unavailable. Retry the review.');
        const review = result.selection_review;
        if (
          ((result.status === 'HIGHER_PRIORITY' || result.status === 'ADVISORY_HIGHER_PRIORITY') &&
            (review == null ||
              !Array.isArray(review.higher_priority_candidates) ||
              review.higher_priority_candidates.length === 0)) ||
          (review !== null &&
            (review == null ||
              (result.status === 'ADVISORY_HIGHER_PRIORITY'
                ? review.specialty_id !== null || review.mode !== 'ADVISORY'
                : typeof review.specialty_id !== 'string') ||
              typeof review.specialty_label !== 'string' ||
              !Array.isArray(review.higher_priority_candidates) ||
              !review.higher_priority_candidates.every(
                (candidate) =>
                  candidate !== null &&
                  typeof candidate === 'object' &&
                  Number.isInteger(candidate.member_id) &&
                  typeof candidate.first_name === 'string' &&
                  typeof candidate.last_name === 'string',
              ) ||
              !Array.isArray(review.eligible_related_position_ids) ||
              !review.eligible_related_position_ids.every((id) => typeof id === 'string') ||
              (result.status === 'ADVISORY_HIGHER_PRIORITY'
                ? review.a_day_timing !== 'ADMIN_REVIEW'
                : review.a_day_timing !== 'ORDINARY_TURN')))
        )
          throw new Error('The specialty review response is unavailable. Retry the review.');
        if (
          result.sequence !== lastLoadedSequence.current ||
          (result.selection_review !== null &&
            (result.selection_review.member_id !== selectionMemberId ||
              result.selection_review.position_id !== selectionPositionId))
        )
          throw new Error('The bid changed. Review the latest specialty availability.');
        if (!disposed) setSelectionReview({ identity: promptIdentity, result, error: null });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setSelectionReview({
            identity: promptIdentity,
            result: null,
            error: error instanceof Error ? error.message : 'Specialty review is unavailable.',
          });
      });
    return () => {
      disposed = true;
    };
  }, [
    needsSpecialtyReview,
    promptIdentity,
    props.bidSessionId,
    selectionMemberId,
    selectionPositionId,
  ]);
  const promptedADay = useRef<string | null>(null);
  const promptedSpecialty = useRef<string | null>(null);
  const dayPromptIdentity = pendingADay
    ? `${pendingADay.member_id}:${pendingADay.position_id}`
    : null;
  useEffect(() => {
    if (props.workspace && dayPromptIdentity !== null && promptedADay.current !== dayPromptIdentity)
      setPanel('a-day');
    else if (props.workspace && dayPromptIdentity === null && promptedADay.current !== null)
      setPanel((current) => (current === 'a-day' ? null : current));
    promptedADay.current = dayPromptIdentity;
  }, [dayPromptIdentity, props.workspace]);
  const specialtyPromptIdentity = state?.active
    ? `${state.active.specialty_id}:${state.active.original_bidder.member_id}`
    : null;
  useEffect(() => {
    if (
      props.workspace &&
      specialtyPromptIdentity !== null &&
      promptedSpecialty.current !== specialtyPromptIdentity
    )
      setPanel('specialty');
    if (props.workspace && specialtyPromptIdentity === null && promptedSpecialty.current !== null)
      setPanel(dayPromptIdentity !== null ? 'a-day' : 'selection');
    promptedSpecialty.current = specialtyPromptIdentity;
  }, [specialtyPromptIdentity, dayPromptIdentity, props.workspace]);
  const specialtyAwardOwner = useRef<number | null>(null);
  useEffect(() => {
    const ids = state?.active?.eligible_position_ids;
    const requested = state?.active?.requested_position_id;
    const candidateId = state?.active?.current_candidate_id ?? null;
    const changed = specialtyAwardOwner.current !== candidateId;
    specialtyAwardOwner.current = candidateId;
    setSpecialtyAwardPositionId((previous) =>
      !changed && previous && (!ids || ids.includes(previous))
        ? previous
        : requested && (!ids || ids.includes(requested))
          ? requested
          : (ids?.[0] ?? ''),
    );
  }, [
    state?.active?.current_candidate_id,
    state?.active?.requested_position_id,
    state?.active?.eligible_position_ids,
  ]);
  const orderSequence = useRef<number | null>(null);
  const [order, setOrder] = useState<RemainingOrderEntry[]>(() => {
    const cursor = props.bidOrder.findIndex((entry) => entry.memberId === props.currentBidderId);
    return remainingOrderEntries(
      props.bidOrder.slice(Math.max(cursor, 0)).map((entry) => entry.memberId),
    );
  });
  const [orderQuery, setOrderQuery] = useState('');

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
    if (lastLoadedSequence.current !== null && next.sequence < lastLoadedSequence.current)
      return lastLoadedSequence.current;
    if (lastLoadedSequence.current !== null && next.sequence > lastLoadedSequence.current)
      props.onCanonicalChange?.();
    lastLoadedSequence.current = next.sequence;
    if (orderSequence.current !== next.sequence) {
      orderSequence.current = next.sequence;
      setOrder(remainingOrderEntries(next.remaining_turns ?? next.remaining_order));
    }
    setState(next);
    setLoadedAt(Date.now());
    setLoadError(null);
    return next.sequence;
  }, [props.bidSessionId, props.onCanonicalChange]);

  useEffect(() => {
    const refresh = () =>
      void load().catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : 'Live controls unavailable.'),
      );
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    function started() {
      generation += 1;
      if (reauthBaseline.current === null)
        reauthBaseline.current = { sequence: lastLoadedSequence.current };
      setAuthRefreshing(true);
    }
    async function refreshed() {
      const currentGeneration = ++generation;
      const baseline = reauthBaseline.current;
      setAuthRefreshing(true);
      try {
        const sequence = await load();
        if (disposed || generation !== currentGeneration) return;
        const changed =
          baseline === null || baseline.sequence === null || baseline.sequence !== sequence;
        setAuthReviewRequired((current) => current || changed);
        reauthBaseline.current = null;
        setAuthRefreshing(false);
        props.onCanonicalChange?.();
        if (changed)
          setNotice(
            'The bid changed during sign-in. Review the latest member and availability before recording an action.',
          );
      } catch (error) {
        if (disposed || generation !== currentGeneration) return;
        setLoadError(error instanceof Error ? error.message : 'Bid updates unavailable.');
        setAuthReviewRequired(true);
        setAuthRefreshing(false);
      }
    }
    window.addEventListener(OPERATOR_REAUTH_STARTED, started);
    window.addEventListener(OPERATOR_AUTH_REFRESHED, refreshed);
    return () => {
      disposed = true;
      generation += 1;
      window.removeEventListener(OPERATOR_REAUTH_STARTED, started);
      window.removeEventListener(OPERATOR_AUTH_REFRESHED, refreshed);
    };
  }, [load, props.onCanonicalChange]);

  useEffect(() => {
    if (
      selectionPositionId &&
      state !== null &&
      (state.fills[selectionPositionId] !== undefined ||
        (props.workspace &&
          !state.selection_stage?.eligible_position_ids.includes(selectionPositionId)))
    ) {
      setSelectionPositionId('');
      setSelectionPoolId('');
    }
  }, [selectionPositionId, state, props.workspace]);

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
    if (authRefreshing || authReviewRequired) {
      setNotice(
        'Refresh operator sign-in and review the latest bid state before recording an action. Your unfinished work is retained.',
      );
      return;
    }
    if (loadError !== null) {
      setNotice(
        'Reconnect and refresh the bid before recording an action. Your selection is preserved.',
      );
      return;
    }
    let detail = inputDetail;
    if (
      type === 'live.record_selection' &&
      membershipChoice.memberId === inputDetail.memberId &&
      membershipChoice.ids.length
    )
      detail = { ...detail, membershipIds: membershipChoice.ids };
    const commandReason =
      type === 'live.set_presentation_mode'
        ? `Operator set audience presentation mode to ${String(inputDetail.mode)}.`
        : reason.trim() ||
          (props.workspace && type === 'live.record_selection'
            ? `Operator recorded member ${String(inputDetail.memberId)} selection of ${String(inputDetail.positionId)}${inputDetail.aDay ? `, A-Day ${String(inputDetail.aDay)}` : ''}.`
            : props.workspace && type === 'live.start_specialty_adjudication'
              ? `Review higher-priority candidates for ${String(inputDetail.positionId)} before the current bidder selects.`
              : props.workspace && type === 'live.resolve_specialty_candidate'
                ? `Record ${String(inputDetail.outcome)} from member ${String(inputDetail.memberId)} for ${String(inputDetail.positionId ?? effectiveSpecialtyAwardId)}.`
                : props.workspace && type === 'live.record_a_day'
                  ? `Record member ${String(inputDetail.memberId)} A-Day ${String(inputDetail.aDay)} at their ordinary turn.`
                  : props.workspace && type === 'live.close_specialty_adjudication'
                    ? 'Resume the original bidder after specialty offers; unresponded priority rights remain pending.'
                    : props.workspace && type === 'live.transition_stage'
                      ? `Continue from the filled ${state?.selection_stage?.label ?? 'current'} stage to ${String(inputDetail.stageId)}; later ordinary selection rights remain pending.`
                      : '');
    const commandEvidenceReference =
      type === 'live.set_presentation_mode' ? null : evidenceReference.trim() || null;
    if (state === null) {
      setNotice('Wait for the current bid to load.');
      return;
    }
    if (commandReason.length > 500) {
      setNotice('Keep the optional note within 500 characters.');
      return;
    }
    const awardsPosition =
      type === 'live.record_selection' ||
      type === 'live.force_selection' ||
      type === 'live.amend_selection' ||
      (type === 'live.resolve_specialty_candidate' && detail.outcome === 'ACCEPT');
    const awardPositionId =
      typeof detail.positionId === 'string'
        ? detail.positionId
        : typeof detail.toPositionId === 'string'
          ? detail.toPositionId
          : type === 'live.resolve_specialty_candidate'
            ? state.active?.requested_position_id
            : undefined;
    const requiresADayWithAward =
      awardsPosition &&
      (type === 'live.record_selection' || type === 'live.force_selection'
        ? requiresADayForAward(awardPositionId, detail.memberId)
        : requiresSimultaneousADay(awardPositionId));
    if (requiresADayWithAward && !detail.aDay) {
      setNotice('Select an A-Day before recording this award.');
      return;
    }
    if (awardsPosition && !requiresADayWithAward && detail.aDay) {
      setNotice(
        'This early award records its A-Day at the member’s ordinary turn; do not record an A-Day now.',
      );
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
      reason: commandReason,
      evidenceReference: commandEvidenceReference,
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
            reason: commandReason,
            evidenceReference: commandEvidenceReference,
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
        throw new Error(commandErrorMessage(body, response.status));
      pendingCommand.current = null;
      if (awardsPosition) {
        setTermChoice({ identity: '', confirmed: false, evidence: '' });
        setSelectionADay('');
        setAmendADay('');
        setSpecialtyADay('');
        setFallbackADay('');
        if (props.workspace) {
          setSelectionPositionId('');
          setSelectionPoolId('');
        }
      }
      const recordedNotice =
        type === 'live.pause'
          ? 'Bid paused and saved. You can close the browser and return to this same bid.'
          : type === 'live.resume'
            ? 'Bid resumed. Continuing the saved turn.'
            : 'Action recorded.';
      setNotice(recordedNotice);
      try {
        await load();
        if (props.workspace && (type === 'live.record_selection' || type === 'live.record_a_day'))
          setPanel(null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Bid updates unavailable.');
        setNotice(`${recordedNotice} Refresh bid updates before recording another action.`);
      }
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
  const normalizedOrderQuery = orderQuery.trim().toLocaleLowerCase();
  const visibleOrder = order
    .map((entry, index) => ({ ...entry, index }))
    .filter(
      (entry) =>
        normalizedOrderQuery === '' ||
        [
          memberName(entry.memberId),
          props.members[String(entry.memberId)]?.employeeId,
          entry.stage_label,
          entry.stageId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedOrderQuery),
    );

  const availablePositions = (props.positions ?? []).filter(
    (position) =>
      state?.selection_stage?.eligible_position_ids.includes(position.id) &&
      state.fills[position.id] === undefined &&
      !poolSlots.has(position.id),
  );
  const availablePools = (state?.opportunity_pools ?? []).filter(
    (pool) =>
      pool.valid &&
      pool.resolvedPositionId !== null &&
      state?.selection_stage?.eligible_position_ids.includes(pool.resolvedPositionId),
  );
  const shifts = [
    ...new Set([
      ...availablePositions.map((position) => position.shift),
      ...availablePools.flatMap((pool) => (pool.shift ? [pool.shift] : [])),
    ]),
  ];
  const visibleShift = shifts.includes(availableShift) ? availableShift : shifts[0];
  const canSelectViewedMember =
    !props.workspace || operator?.selectedMemberId === selectionMemberId;
  const priorityCandidateRow = (candidate: Candidate) => (
    <li key={candidate.member_id} className="flex flex-wrap items-center justify-between gap-2">
      {name(candidate)} · {candidate.points ?? 0} points
      {priorityAdvisory && state?.admin_override_allowed ? (
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            operator?.requestOverride(priorityReview?.position_id, candidate.member_id, true)
          }
        >
          Assign {candidate.first_name} {candidate.last_name}
        </Button>
      ) : null}
    </li>
  );
  const coverageWarnings = [
    ...(state?.specialty_coverage?.availability === 'UNAVAILABLE'
      ? ['specialty coverage unavailable']
      : state?.specialty_coverage?.status && state.specialty_coverage.status !== 'FEASIBLE'
        ? [`specialty coverage ${state.specialty_coverage.status.replace('_', ' ').toLowerCase()}`]
        : []),
    ...(state?.credential_coverage?.availability === 'UNAVAILABLE'
      ? ['qualification coverage unavailable']
      : (state?.credential_coverage?.groups ?? [])
          .filter((group) => group.status !== 'FEASIBLE')
          .map(
            (group) =>
              `${group.label}: ${group.eligible_member_count} qualified / ${group.remaining_seat_count} seats`,
          )),
  ];
  const coverageSummary = coverageWarnings.length
    ? `${coverageWarnings.length} staffing ${coverageWarnings.length === 1 ? 'alert' : 'alerts'}`
    : '';

  return (
    <section
      className={
        props.workspace
          ? 'flex min-h-0 flex-1 flex-col bg-card'
          : 'border-y border-border bg-card p-3'
      }
      data-testid="annual-live-controls"
    >
      <div
        className={
          props.workspace
            ? 'relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1'
            : ''
        }
      >
        {authRefreshing || authReviewRequired ? (
          <div className="order-first mb-3 w-full border border-info/30 bg-info/10 p-3 text-sm">
            <p aria-live="polite">
              {authRefreshing
                ? 'Waiting for verified operator sign-in and current bid updates. Your unfinished work is retained.'
                : 'The bid changed during sign-in. Review the current member, available positions and your prepared selection.'}
            </p>
            {authReviewRequired ? (
              <Button
                type="button"
                className="mt-2"
                disabled={authRefreshing || loadError !== null}
                onClick={() => {
                  setAuthReviewRequired(false);
                  setNotice('Latest bid state reviewed. Confirm your prepared action when ready.');
                }}
              >
                I reviewed the latest bid state
              </Button>
            ) : null}
          </div>
        ) : null}
        {loadError !== null ? (
          <div
            role="alert"
            className="order-first mb-3 w-full border border-warning/30 bg-warning/10 p-3 text-sm"
          >
            <p>
              Bid updates are unavailable. Showing the last loaded information; actions are blocked
              until the connection recovers.
            </p>
            <Button
              type="button"
              className="mt-2"
              onClick={() =>
                void load().catch((error: unknown) =>
                  setLoadError(error instanceof Error ? error.message : 'Bid updates unavailable.'),
                )
              }
            >
              Retry bid updates
            </Button>
          </div>
        ) : null}
        {state !== null ? (
          <AdministratorOverride
            compact={props.workspace === true}
            bidSessionId={props.bidSessionId}
            allowed={state.admin_override_allowed === true}
            memberIds={state.admin_override_member_ids ?? []}
            positionIds={state.admin_override_position_ids ?? []}
            opportunityPools={state.opportunity_pools}
            members={props.members}
            positions={props.positions ?? []}
            fills={state.fills}
            nonBiddablePositions={state.available_non_biddable_positions}
            onChooseTask={(task) => {
              if (task === 'correction') setCorrectionRequest((value) => value + 1);
              else setPanel(task);
            }}
            sequence={state.sequence}
            currentMemberId={selectionMemberId}
            currentStage={state.selection_stage?.label}
            currentStageId={state.selection_stage?.id}
            combatGroups={state.a_day_combat_groups}
            aDayTiming={state.a_day_timing_by_position}
            defaultADayTiming={state.a_day_selection}
            termParticipation={state.term_participation}
            commandsBlocked={loadError !== null || authRefreshing || authReviewRequired || busy}
            onCanonicalChange={() => {
              void load().catch((error: unknown) =>
                setLoadError(error instanceof Error ? error.message : 'Bid updates unavailable.'),
              );
              props.onCanonicalChange?.();
            }}
          />
        ) : null}
        {props.workspace ? (
          <section aria-label="Available positions" className="min-w-0">
            <details>
              <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
                Eligible choices · {availablePositions.length + availablePools.length}
              </summary>
              <div className="absolute left-0 top-full z-30 mt-1 max-h-[50dvh] w-full max-w-xl overflow-y-auto rounded border border-border bg-card p-3 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {state?.selection_stage?.label ?? 'Loading bid stage'}
                    </p>
                    <h2 className="mt-1 font-heading text-lg font-bold">Available positions</h2>
                  </div>
                  <Button type="button" onClick={() => setPanel('presentation')}>
                    Presentation controls
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {availablePositions.length + availablePools.length} choices
                    {loadedAt !== null ? (
                      <span className="block text-xs">
                        Updated {new Date(loadedAt).toLocaleTimeString()}
                      </span>
                    ) : null}
                  </p>
                </div>
                {state === null ? (
                  <output className="mt-3 block text-sm">
                    Loading current bidder and openings…
                  </output>
                ) : selectionMember ? (
                  <p className="mt-2 text-sm">
                    Selecting for <strong>{name(selectionMember)}</strong>
                  </p>
                ) : (
                  <p className="mt-2 text-sm">No member is currently selecting a position.</p>
                )}
                {shifts.length > 1 ? (
                  <fieldset className="mt-3 flex flex-wrap gap-2" aria-label="Available shift">
                    <span className="sr-only">Choose shift</span>
                    {shifts.map((shift) => (
                      <Button
                        key={shift}
                        type="button"
                        variant={visibleShift === shift ? 'primary' : 'default'}
                        aria-pressed={visibleShift === shift}
                        onClick={() => setAvailableShift(shift)}
                      >
                        {shift === 'D' ? 'Days' : `${shift} shift`}
                      </Button>
                    ))}
                  </fieldset>
                ) : null}
                <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2">
                  {availablePositions
                    .filter((position) => position.shift === visibleShift)
                    .map((position) => (
                      <button
                        key={position.id}
                        type="button"
                        disabled={!canSelectViewedMember || busy || pendingADay !== null}
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          setSelectionPositionId(position.id);
                          setSelectionPoolId('');
                          setPanel('selection');
                          setNotice(null);
                        }}
                        aria-pressed={selectionPositionId === position.id && !selectionPoolId}
                        className="min-h-16 border border-border bg-card px-3 py-2 text-left hover:border-info hover:bg-info/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-info aria-pressed:bg-info/10"
                      >
                        <span className="block text-sm font-semibold">
                          {position.unit} · {position.positionName}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {position.station} · {position.id}
                        </span>
                      </button>
                    ))}
                  {availablePools
                    .filter((pool) => pool.shift === visibleShift)
                    .map((pool) => (
                      <button
                        key={pool.id}
                        type="button"
                        disabled={!canSelectViewedMember || busy || pendingADay !== null}
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          setSelectionPoolId(pool.id);
                          setSelectionPositionId(pool.resolvedPositionId ?? '');
                          setPanel('selection');
                          setNotice(null);
                        }}
                        aria-pressed={selectionPoolId === pool.id}
                        className="min-h-16 border border-border bg-card px-3 py-2 text-left hover:border-info hover:bg-info/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 aria-pressed:border-info aria-pressed:bg-info/10"
                      >
                        <span className="block text-sm font-semibold">{pool.label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {pool.remaining} of {pool.capacity} available · pool selection
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            </details>
            {state?.current_phase === 'position_bid' &&
            state.selection_stage?.all_opportunities_filled &&
            state.selection_stage.next_stage &&
            !state.returning_member &&
            (state.unresolved_members?.length ?? 0) === 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <p className="text-sm">All {state.selection_stage.label} seats are filled.</p>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy || authRefreshing || authReviewRequired || loadError !== null}
                  onClick={() =>
                    void command('live.transition_stage', {
                      stageId: state.selection_stage?.next_stage?.id,
                    })
                  }
                >
                  Continue to {state.selection_stage.next_stage.label}
                </Button>
              </div>
            ) : state !== null && availablePositions.length + availablePools.length === 0 ? (
              <p className="mt-3 text-sm text-warning">
                No eligible openings in this stage. Use Disposition and return to record the
                member’s next action.
              </p>
            ) : null}
          </section>
        ) : null}
        {props.isMock && !props.workspace ? (
          <p className="mb-4 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-sky-900">
            MOCK REHEARSAL — canonical commands remain isolated from staffing and portal write-back.
          </p>
        ) : null}
        <CoverageDetails
          compact={props.workspace === true && coverageSummary.length > 0}
          summary={coverageSummary}
        >
          {state?.specialty_coverage &&
          (!props.workspace ||
            state.specialty_coverage.availability === 'UNAVAILABLE' ||
            state.specialty_coverage.status !== 'FEASIBLE') ? (
            <section
              className="mb-4 rounded border border-border bg-muted/30 px-3 py-2 text-sm"
              data-testid="specialty-coverage-advisory"
              aria-live="polite"
            >
              <h2 className="font-semibold text-foreground">Specialty coverage</h2>
              {state.specialty_coverage.availability === 'UNAVAILABLE' ? (
                <p className="mt-2 text-sm text-warning">
                  Coverage unavailable.{' '}
                  <span className="text-xs">{state.specialty_coverage.code}</span>
                </p>
              ) : (
                <div className="mt-2 space-y-1 text-sm">
                  <p>
                    <strong>{state.specialty_coverage.status.replace('_', ' ')}</strong> ·{' '}
                    {state.specialty_coverage.remaining_specialty_seat_count} seats left
                  </p>
                  {state.specialty_coverage.guaranteed_uncovered_seat_count > 0 ? (
                    <p className="text-warning">
                      {state.specialty_coverage.guaranteed_uncovered_seat_count} remaining specialty{' '}
                      {state.specialty_coverage.guaranteed_uncovered_seat_count === 1
                        ? 'seat is'
                        : 'seats are'}{' '}
                      lack enough eligible members.
                    </p>
                  ) : null}
                  {state.specialty_coverage.critical_member_ids.length > 0 ? (
                    <p>
                      {state.specialty_coverage.critical_member_ids.length} members are needed to
                      cover the remaining seats.
                    </p>
                  ) : null}
                </div>
              )}
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="min-h-11 cursor-pointer content-center font-medium">
                  Coverage details
                </summary>
                <p>
                  Advisory only, based on saved qualifications and current awards. Your adjustments
                  remain available.
                </p>
                {state.specialty_coverage.availability === 'AVAILABLE' ? (
                  <p>
                    {state.specialty_coverage.filled_specialty_seat_count} of{' '}
                    {state.specialty_coverage.total_specialty_seat_count} specialty seats filled.
                  </p>
                ) : null}
              </details>
            </section>
          ) : null}
          {state?.credential_coverage?.availability === 'AVAILABLE' &&
          state.credential_coverage.groups?.some((group) => group.status !== 'FEASIBLE') ? (
            <section
              aria-label="Qualification coverage warnings"
              data-testid="credential-coverage-advisory"
              className="mb-3 border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
              aria-live="polite"
            >
              <h2 className="font-semibold">Qualification coverage is low</h2>
              <ul className="mt-1 divide-y divide-warning/20">
                {state.credential_coverage.groups
                  .filter((group) => group.status !== 'FEASIBLE')
                  .map((group) => (
                    <li
                      key={group.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1"
                    >
                      <span className="min-w-0 font-medium" title={group.label}>
                        {group.label.includes(' + ')
                          ? `${group.label.split(' + ')[0]} + ${group.label.split(' + ').length - 1} requirements`
                          : group.label}
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        {group.eligible_member_count} qualified / {group.remaining_seat_count} seats
                        {group.status === 'SHORTAGE' ? ' · Shortage' : ' · Low buffer'}
                      </span>
                    </li>
                  ))}
              </ul>
              <details className="mt-1 text-xs">
                <summary className="min-h-11 cursor-pointer content-center font-medium">
                  Qualifications and members
                </summary>
                <p className="mb-2">
                  Keep enough qualified members for these seats. Use Adjust bid for a forced
                  assignment.
                </p>
                {state.credential_coverage.groups
                  .filter((group) => group.status !== 'FEASIBLE')
                  .map((group) => (
                    <div key={group.id} className="mb-2">
                      <strong>{group.label}</strong>
                      <p>
                        {group.eligible_member_count} qualified members left for{' '}
                        {group.remaining_seat_count} open seats.
                      </p>
                      {group.critical_member_ids.length ? (
                        <p>
                          Needed for coverage:{' '}
                          {group.critical_member_ids.map(memberName).join(', ')}
                        </p>
                      ) : null}
                      <details>
                        <summary className="min-h-11 cursor-pointer content-center">
                          View qualified members
                        </summary>
                        <p>{group.eligible_member_ids.map(memberName).join(', ')}</p>
                      </details>
                    </div>
                  ))}
              </details>
            </section>
          ) : state?.credential_coverage?.availability === 'UNAVAILABLE' ? (
            <output className="mb-3 block text-sm text-warning">
              Qualification coverage could not be checked. Refresh the bid before relying on this
              advisory.
            </output>
          ) : null}
        </CoverageDetails>
        {pendingADay !== null && props.workspace ? (
          <div className="order-3 mb-1 flex w-full flex-wrap items-center justify-between gap-2 border border-info/30 bg-info/10 px-3 py-1 text-sm">
            <p>
              <strong>{memberName(pendingADay.member_id)} is now due to select an A-Day</strong> for{' '}
              {pendingADay.position_id}.
            </p>
            <Button type="button" onClick={() => setPanel('a-day')}>
              Choose A-Day
            </Button>
          </div>
        ) : null}
        {state?.exceptional_assignments?.length ? (
          <details className="order-3 w-full border-t border-border pt-2 text-sm">
            <summary className="cursor-pointer font-semibold">
              Chief-directed roles ({state.exceptional_assignments.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {state.exceptional_assignments.map((assignment) => (
                <li key={assignment.assignment_id}>
                  {memberName(assignment.member_id)} · {assignment.role_label} · Forced
                </li>
              ))}
            </ul>
            <Button type="button" className="mt-2" onClick={() => setPanel('exceptional')}>
              Manage directed roles
            </Button>
          </details>
        ) : null}
        <details
          open={props.workspace ? undefined : true}
          className={props.workspace ? 'order-1' : ''}
          onClick={(event) => {
            if (
              props.workspace &&
              event.target instanceof Element &&
              event.target.closest('button')
            )
              event.currentTarget.open = false;
          }}
          onKeyDown={(event) => {
            if (props.workspace && event.key === 'Escape') {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}
        >
          {props.workspace ? (
            <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
              More controls
            </summary>
          ) : null}
          <div
            className={
              props.workspace
                ? 'absolute left-0 top-full z-30 mt-1 flex max-h-[50dvh] w-full max-w-lg flex-wrap items-center gap-2 overflow-y-auto rounded border border-border bg-card p-3 shadow-lg'
                : 'flex flex-wrap items-center gap-2'
            }
          >
            <CorrectBid
              bidSessionId={props.bidSessionId}
              members={props.members}
              canonicalSequence={state?.sequence}
              openRequest={correctionRequest}
              requestedMemberId={operator?.selectedMemberId}
              overrideAllowed={state?.admin_override_allowed === true}
              overridePositionIds={state?.admin_override_position_ids}
              commandsBlocked={
                state === null || loadError !== null || authRefreshing || authReviewRequired || busy
              }
              onCanonicalChange={() => {
                void load().catch((error: unknown) =>
                  setLoadError(error instanceof Error ? error.message : 'Bid updates unavailable.'),
                );
                props.onCanonicalChange?.();
              }}
            />
            {(
              [
                ['selection', 'Record selection'],
                ['disposition', 'Skip or return a member'],
                ['a-day', 'A-Day due'],
                ['specialty', 'Specialty review'],
                ['fallback', 'Fill remaining seats'],
                ...(state?.admin_override_allowed
                  ? ([['exceptional', 'Temporary duties']] as const)
                  : []),
                ['presentation', 'Presentation'],
                ['session', 'Pause or resume bid'],
                ...(props.workspace === true
                  ? []
                  : ([['amendment', 'Correct selection']] as const)),
                ['order', 'Bid order'],
                ...(state?.current_phase === 'complete' && !state.finalization_ready
                  ? ([['finalization', 'Finalize results']] as const)
                  : []),
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
        </details>
        {state?.active && (
          <p className="order-3 w-full text-sm text-warning">
            Specialty review in progress: {state.active.specialty_label}.{' '}
            <Button type="button" onClick={() => setPanel('specialty')}>
              Continue review
            </Button>
          </p>
        )}
        {notice && panel === null ? (
          <output className="order-3 block w-full text-sm">{notice}</output>
        ) : null}
      </div>
      {props.board ? (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="operator-seat-board">
          {state?.a_day_combat_groups?.length ? (
            <div
              className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-y border-border px-3 py-2 text-xs"
              aria-label="Recorded A-Day groups"
            >
              <span className="font-semibold">A-Day groups</span>
              {state.a_day_combat_groups.map((group) => (
                <span key={group} className="whitespace-nowrap tabular-nums">
                  {group.replace(/^G(\d+)$/, 'Group $1')} ·{' '}
                  {Object.values(state.fills).filter((fill) => fill.a_day === group).length}{' '}
                  recorded
                </span>
              ))}
            </div>
          ) : null}
          {props.board}
        </div>
      ) : null}
      <SelectionFrame
        inline={false}
        open={panel !== null}
        onClose={() => {
          setPanel(null);
        }}
        title={
          panel === 'specialty'
            ? 'Specialty and contact'
            : panel === 'disposition'
              ? 'Disposition, contact, and return'
              : panel === 'a-day'
                ? 'Choose A-Day'
                : panel === 'fallback'
                  ? 'Fill remaining seats'
                  : panel === 'presentation'
                    ? 'Department presentation'
                    : panel === 'session'
                      ? 'Pause or resume bid'
                      : panel === 'amendment'
                        ? 'Correct a recorded selection'
                        : panel === 'order'
                          ? 'Remaining bid order'
                          : panel === 'exceptional'
                            ? 'Chief-directed role'
                            : panel === 'finalization'
                              ? 'Finalize completed results'
                              : 'Record selection'
        }
        description={
          panel === 'presentation'
            ? 'Choose what the audience sees.'
            : 'Review the member and action, then confirm. Adjust bid lets you override policy advice.'
        }
      >
        {notice ? (
          <output aria-live="polite" className="mb-3 block border-l-2 border-info pl-3 text-sm">
            {notice}
          </output>
        ) : null}
        {panel !== 'presentation' && termRight && termMemberId != null && (
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
        {panel !== 'presentation' && (
          <>
            <OperatorNotes optional>
              <div
                className={`flex flex-wrap items-end gap-3 ${props.workspace && panel === 'selection' ? 'order-3' : ''}`}
              >
                <Label className="min-w-0 w-full text-xs text-muted-foreground">
                  Note (optional)
                  <Input
                    value={reason}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm text-foreground"
                  />
                </Label>
              </div>
            </OperatorNotes>
            <details open={panel === 'disposition'} className="mt-2 border-t border-border pt-2">
              <summary className="min-h-11 cursor-pointer content-center text-sm text-muted-foreground">
                Evidence reference
              </summary>
              <Label className="min-w-0 w-full text-xs text-muted-foreground">
                Evidence reference (when policy requires)
                <Input
                  value={evidenceReference}
                  onChange={(event) => setEvidenceReference(event.target.value)}
                  className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm text-foreground"
                />
              </Label>
            </details>
          </>
        )}

        <div className="mt-4 space-y-4">
          <article hidden={panel !== 'exceptional'} className="space-y-3">
            <p className="text-sm">
              Record a temporary duty such as acting Division Chief of Prevention. The member’s
              official rank stays unchanged; their ordinary bid turns are held while assigned.
            </p>
            <Label className="block text-sm">
              Find member
              <Input
                aria-label="Find directed-role member"
                value={actingMemberQuery}
                onChange={(event) => setActingMemberQuery(event.target.value)}
              />
            </Label>
            <Label className="block text-sm">
              Member to assign
              <NativeSelect
                aria-label="Directed-role member"
                value={actingMemberId}
                onChange={(event) => {
                  setActingMemberId(event.target.value);
                  setActingConfirmed(false);
                }}
              >
                <option value="">Choose a bid participant</option>
                {(state?.admin_override_member_ids ?? [])
                  .filter((id) => props.members[String(id)])
                  .filter(
                    (id) =>
                      String(id) === actingMemberId ||
                      memberName(id).toLowerCase().includes(actingMemberQuery.trim().toLowerCase()),
                  )
                  .map((id) => (
                    <option key={id} value={id}>
                      {memberName(id)}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
            <Label className="block text-sm">
              Link to a closed role (optional)
              <NativeSelect
                aria-label="Directed non-biddable role"
                value={actingPositionId}
                onChange={(event) => {
                  const id = event.target.value;
                  setActingPositionId(id);
                  const role = state?.available_non_biddable_positions?.find(
                    (position) => position.position_id === id,
                  );
                  if (role) setActingRoleLabel(role.label);
                  setActingConfirmed(false);
                }}
              >
                <option value="">Custom temporary duty</option>
                {state?.available_non_biddable_positions?.map((position) => (
                  <option key={position.position_id} value={position.position_id}>
                    {position.position_id} · {position.label}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label className="block text-sm">
              Duty / acting role
              <Input
                aria-label="Directed role label"
                value={actingRoleLabel}
                onChange={(event) => {
                  setActingRoleLabel(event.target.value);
                  setActingConfirmed(false);
                }}
                placeholder="Enter the Chief’s directed role"
              />
            </Label>
            <Label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                aria-label="I reviewed the directed role"
                checked={actingConfirmed}
                onChange={(event) => setActingConfirmed(event.target.checked)}
              />
              Record {actingMemberId ? memberName(Number(actingMemberId)) : 'this member'} as forced
              into {actingRoleLabel || 'the directed duty'}. An existing seat stays assigned.
            </Label>
            <ReviewedBidAdjustment
              sessionId={props.bidSessionId}
              sequence={state?.sequence ?? 0}
              detail={{
                type: 'live.set_exceptional_assignment',
                operation: 'ASSIGN',
                memberId: Number(actingMemberId),
                roleLabel: actingRoleLabel.trim(),
                ...(actingPositionId ? { positionId: actingPositionId } : {}),
              }}
              reason={reason}
              disabled={
                busy ||
                !actingConfirmed ||
                !actingMemberId ||
                actingRoleLabel.trim().length < 4 ||
                state?.admin_override_allowed !== true ||
                loadError !== null ||
                authRefreshing ||
                authReviewRequired
              }
              label="Temporary duty"
              onSaved={() => {
                setActingConfirmed(false);
                void load().catch(() => setLoadError('Bid updates unavailable.'));
                props.onCanonicalChange?.();
              }}
            />
            {state?.exceptional_assignments?.length ? (
              <section className="border-t border-border pt-3">
                <h3 className="font-semibold">Return a member to the bid</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Release the duty to return their unawarded turn to the current sequence.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {state.exceptional_assignments.map((assignment) => (
                    <ReviewedBidAdjustment
                      key={assignment.assignment_id}
                      sessionId={props.bidSessionId}
                      sequence={state.sequence}
                      detail={{
                        type: 'live.set_exceptional_assignment',
                        operation: 'RELEASE',
                        memberId: assignment.member_id,
                        roleLabel: assignment.role_label,
                        ...(assignment.position_id ? { positionId: assignment.position_id } : {}),
                      }}
                      reason={reason}
                      disabled={busy || loadError !== null || authRefreshing || authReviewRequired}
                      label={`Release ${memberName(assignment.member_id)}`}
                      onSaved={() => {
                        void load().catch(() => setLoadError('Bid updates unavailable.'));
                        props.onCanonicalChange?.();
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </article>
          <article hidden={panel !== 'disposition'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Record bidder disposition</h3>
            <p className="text-xs text-muted-foreground">
              Contact attempts and disposition outcomes are audited canonical commands. An
              unreachable outcome requires the evidence reference above.
            </p>
            {dispositionMember ? (
              <div className="mt-3 space-y-3 text-sm">
                <p>
                  {state?.returning_member ? 'Returned bidder: ' : 'Current bidder: '}
                  <strong>{name(dispositionMember)}</strong>
                </p>
                {state?.returning_member && state.current_bidder ? (
                  <p className="text-xs text-muted-foreground">
                    {name(state.current_bidder)} remains next in the ordinary order. Finish the
                    returned bidder’s action first.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {(['PHONE', 'TEXT'] as const).map((method) => (
                    <Button
                      key={method}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void command('live.record_contact_attempt', {
                          memberId: dispositionMember.member_id,
                          method,
                        })
                      }
                    >
                      Record {method}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(state?.dispositions ?? []).map((entry) => (
                    <Button
                      key={entry.disposition}
                      type="button"
                      disabled={busy || (entry.requiresEvidence && !evidenceReference.trim())}
                      onClick={() =>
                        void command('live.disposition', { disposition: entry.disposition })
                      }
                    >
                      Record {entry.disposition}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No bidder is currently active.</p>
            )}
            {state?.current_phase === 'position_bid' &&
            state.selection_stage?.all_opportunities_filled &&
            state.selection_stage.next_stage &&
            !state.returning_member &&
            (state.unresolved_members?.length ?? 0) === 0 ? (
              <div className="mt-4 border-t border-border pt-3">
                <h4 className="font-semibold text-foreground">Stage complete</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every {state.selection_stage.label} opportunity is filled. Advancing skips the
                  remaining turns in this stage and records the transition in the session audit.
                </p>
                <Button
                  type="button"
                  className="mt-2"
                  disabled={busy}
                  onClick={() =>
                    void command('live.transition_stage', {
                      stageId: state.selection_stage?.next_stage?.id,
                    })
                  }
                >
                  Advance to {state.selection_stage.next_stage.label}
                </Button>
              </div>
            ) : null}
            {(state?.unresolved_members ?? []).length > 0 ? (
              <div className="mt-4 border-t border-border pt-3">
                <h4 className="font-semibold text-foreground">Return an unresolved bidder</h4>
                <p className="text-xs text-muted-foreground">
                  The returned member selects at the current sequence without rewinding completed
                  awards.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {state?.unresolved_members?.map((candidate) => (
                    <Button
                      key={candidate.member_id}
                      type="button"
                      disabled={busy || state.returning_member != null}
                      onClick={() =>
                        void command('live.return_at_current_sequence', {
                          memberId: candidate.member_id,
                        })
                      }
                    >
                      Return {name(candidate)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
          <article hidden={panel !== 'a-day'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Choose A-Day for the recorded seat</h3>
            <p className="text-xs text-muted-foreground">
              The specialty seat is already saved. Select the A-Day now at this member’s ordinary
              turn.
            </p>
            {pendingADay === null ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No controlled A-Day selection is awaiting an authorized operator.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm">
                  Current member: {memberName(pendingADay.member_id)} · opportunity{' '}
                  {pendingADay.position_id} · {pendingADay.shift}-shift.
                </p>
                <ADayChoice
                  label="Controlled A-Day"
                  position={props.positions?.find(
                    (position) => position.id === pendingADay.position_id,
                  )}
                  shift={pendingADay.shift}
                  combatGroups={state?.a_day_combat_groups}
                  unavailable={Object.fromEntries(
                    aDayOptions(
                      props.positions?.find((position) => position.id === pendingADay.position_id),
                      pendingADay.shift,
                      state?.a_day_combat_groups,
                    )
                      .filter((group) => !pendingADay.eligible_a_days.includes(group))
                      .map((group) => [group, 'Unavailable for this recorded seat']),
                  )}
                  value={deferredADay}
                  onChange={setDeferredADay}
                />
                <Button
                  type="button"
                  disabled={
                    busy || !deferredADay || !pendingADay.eligible_a_days.includes(deferredADay)
                  }
                  onClick={() =>
                    void command('live.record_a_day', {
                      memberId: pendingADay.member_id,
                      aDay: deferredADay,
                    })
                  }
                  className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
                >
                  Commit controlled A-Day
                </Button>
              </>
            )}
          </article>
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
                  fallback.code === 'FALLBACK_TIMING_NEEDS_ADMIN_DECISION' ? (
                    <output>
                      NEEDS ADMIN DECISION: The saved policy does not establish when this fallback
                      may begin. Record the governing source and timing condition in a reviewed
                      successor Bid configuration.
                    </output>
                  ) : fallback.code === 'FALLBACK_ORDINARY_PATH_NOT_EXHAUSTED' ? (
                    <output>
                      Qualified ordinary contenders still have selection rights. Complete their
                      opportunity or resolve retained rights under the saved policy before fallback
                      can begin.
                      {fallback.blockingMemberIds?.length ? (
                        <span>
                          {' '}
                          Awaiting: {fallback.blockingMemberIds.map(memberName).join(', ')}.
                        </span>
                      ) : null}
                    </output>
                  ) : (
                    <output>Fallback unavailable: {fallback.code}</output>
                  )
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
                        {fallbackRequiresSimultaneousADay ? (
                          <ADayChoice
                            label="Fallback award A-Day"
                            position={fallbackPosition}
                            combatGroups={state?.a_day_combat_groups}
                            value={fallbackADay}
                            onChange={setFallbackADay}
                          />
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            disabled={busy || (fallbackRequiresSimultaneousADay && !fallbackADay)}
                            onClick={() => {
                              if (
                                fallback.mode === 'FORCED' &&
                                !window.confirm(
                                  `Confirm forced award to ${memberName(fallbackMemberId)} for ${fallback.positionId} under ${fallback.tierLabel}${fallbackRequiresSimultaneousADay ? `, A-Day ${fallbackADay}` : ''}?`,
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
                                  ...(fallbackRequiresSimultaneousADay
                                    ? { aDay: fallbackADay }
                                    : {}),
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
          <article hidden={panel !== 'session'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Pause or resume bid</h3>
            <p className="mt-1 text-sm">
              {state?.current_phase === 'paused'
                ? 'Paused selections and the current turn are saved. Resume whenever you are ready.'
                : 'Save a break for minutes or days. Your selections and current turn stay in this bid.'}
            </p>
            <Button
              type="button"
              disabled={
                busy ||
                state === null ||
                state.current_phase === 'complete' ||
                loadError !== null ||
                authRefreshing ||
                authReviewRequired
              }
              className="mt-3"
              onClick={() =>
                void command(state?.current_phase === 'paused' ? 'live.resume' : 'live.pause')
              }
            >
              {state?.current_phase === 'paused' ? 'Resume bid' : 'Pause bid'}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Pausing is reversible. Freeze is a separate administrative action.
            </p>
            <a
              href={`/admin/bid?${new URLSearchParams({ session_id: props.bidSessionId })}`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline"
            >
              Return to this bid
            </a>
            {props.isMock ? (
              <a
                href="/admin/rehearsal"
                className="ml-4 mt-2 inline-flex min-h-11 items-center text-sm underline"
              >
                Find saved Mocks
              </a>
            ) : null}
          </article>
          <article hidden={panel !== 'presentation'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Department presentation</h3>
            <p className="text-xs text-muted-foreground">
              Display controls never pause Bid execution.
            </p>
            <div className="mt-3">
              <SessionPresentationLink sessionId={props.bidSessionId} isMock={props.isMock} />
            </div>
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
                  disabled={
                    busy ||
                    state === null ||
                    loadError !== null ||
                    authRefreshing ||
                    authReviewRequired
                  }
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
            <p className="mt-1 text-xs text-muted-foreground">
              Use this when the current bidder qualifies for the requested specialty seat and a
              higher-priority qualified candidate may need review. The frozen Bid rules verify both
              conditions before suspending the turn.
            </p>
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
              Review higher-priority members
            </Button>
          </article>

          {state?.active ? (
            <article
              hidden={panel !== 'specialty'}
              className="rounded border border-amber-500 bg-amber-50 p-3 xl:col-span-2"
            >
              <h3 className="font-semibold text-amber-950">
                {state.active.specialty_label} priority review
              </h3>
              <p className="mt-1 text-sm text-amber-900">
                Original bidder: {name(state.active.original_bidder)} ·{' '}
                {state.active.original_bidder.points ?? 0} points · policy rank{' '}
                {state.active.original_bidder.policy_rank ?? '—'}. Their turn resumes after review.
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
                    Offer to {name(currentCandidate)} · {currentCandidate.points ?? 0} points
                  </strong>
                  {state.active.eligible_position_ids ? (
                    <Label className="w-full text-sm">
                      Specialty seat to offer
                      <NativeSelect
                        aria-label="Specialty seat to offer"
                        value={specialtyAwardPositionId}
                        disabled={busy}
                        onChange={(event) => setSpecialtyAwardPositionId(event.target.value)}
                      >
                        <option value="">Choose an eligible specialty seat</option>
                        {state.active.eligible_position_ids.map((id) => {
                          const position = props.positions?.find((entry) => entry.id === id);
                          return (
                            <option key={id} value={id}>
                              {id} · {position?.positionName ?? id}
                            </option>
                          );
                        })}
                      </NativeSelect>
                    </Label>
                  ) : null}
                  {!specialtyRequiresSimultaneousADay ? (
                    <p className="w-full text-sm">
                      A-Day deferred automatically until this member’s ordinary turn.
                    </p>
                  ) : null}
                  {specialtyRequiresSimultaneousADay ? (
                    <ADayChoice
                      label="Specialty award A-Day"
                      position={specialtyPosition}
                      combatGroups={state?.a_day_combat_groups}
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
                        busy ||
                        (outcome === 'ACCEPT' &&
                          (!effectiveSpecialtyAwardId ||
                            (state.active?.eligible_position_ids !== undefined &&
                              !state.active?.eligible_position_ids.includes(
                                effectiveSpecialtyAwardId,
                              )) ||
                            (specialtyRequiresSimultaneousADay && !specialtyADay)))
                      }
                      onClick={() =>
                        void command('live.resolve_specialty_candidate', {
                          memberId: currentCandidate.member_id,
                          outcome,
                          ...(outcome === 'ACCEPT'
                            ? { positionId: effectiveSpecialtyAwardId }
                            : {}),
                          ...(outcome === 'ACCEPT' && specialtyRequiresSimultaneousADay
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
              <Button
                type="button"
                disabled={busy}
                onClick={() => void command('live.close_specialty_adjudication')}
                className="mt-3"
              >
                Resume original bidder
              </Button>
            </article>
          ) : null}

          <article hidden={panel !== 'selection'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">
              {props.workspace
                ? 'Review selection'
                : state?.returning_member
                  ? 'Record returned bidder selection'
                  : 'Record current bidder selection'}
            </h3>
            {!props.workspace ? (
              <p className="text-xs text-muted-foreground">
                {selectionMember
                  ? `${name(selectionMember)} selects from the frozen stage's eligible opportunities.`
                  : 'The frozen stage policy remains enforced.'}
              </p>
            ) : null}
            {state?.selection_stage && !props.workspace ? (
              <p className="mt-2 text-xs font-medium text-foreground">
                Current stage: {state.selection_stage.label}
              </p>
            ) : null}
            {pendingADay !== null ? (
              <p className="mt-2 text-sm text-warning">
                {memberName(pendingADay.member_id)} already holds {pendingADay.position_id}.
                Complete the deferred A-Day through Record A-Day before the next position selection.
              </p>
            ) : null}
            {state?.selection_stage && state.selection_stage.eligible_position_ids.length === 0 ? (
              <p className="mt-1 text-xs text-amber-800">
                No open opportunity in this stage is currently eligible for this member. Use the
                reviewed disposition or fallback controls.
              </p>
            ) : null}
            {props.workspace && selectionMember ? (
              <p className="mt-2 text-sm">
                Selecting for <strong>{name(selectionMember)}</strong>
              </p>
            ) : null}
            {props.workspace && selectionPosition ? (
              <p className="mt-2 text-sm">
                {`${selectionPosition.id} · ${selectionPosition.station} · ${selectionPosition.unit} · ${selectionPosition.positionName}`}
              </p>
            ) : null}
            <Label className="mt-2 block text-sm">
              Seat
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
                  ?.filter(
                    (position) =>
                      !position.bidParticipation || position.bidParticipation === 'BIDDABLE',
                  )
                  ?.filter((position) =>
                    state?.selection_stage?.eligible_position_ids.includes(position.id),
                  )
                  ?.filter((position) => !poolSlots.has(position.id))
                  .filter((position) =>
                    state === null
                      ? props.fills[position.id] === undefined
                      : state.fills[position.id] === undefined,
                  )
                  .map((position) => (
                    <option key={position.id} value={position.id}>
                      {props.workspace
                        ? `${position.id} · ${position.shift === 'D' ? 'Days' : `${position.shift} Shift`} · ${position.station} · ${position.unit} · ${position.positionName}`
                        : `${position.id} · ${position.positionName}`}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
            {needsSpecialtyReview ? (
              <section
                aria-label="Specialty selection review"
                className="mt-3 border border-warning/40 bg-warning/5 p-3 text-sm"
              >
                {prompt?.error ? (
                  <>
                    <p role="alert">{prompt.error}</p>
                    <Button type="button" onClick={() => setReviewRetry((current) => current + 1)}>
                      Retry specialty review
                    </Button>
                  </>
                ) : prompt?.result == null ? (
                  <output>Checking specialty priority…</output>
                ) : (priorityReviewRequired || priorityAdvisory) && priorityReview ? (
                  <>
                    <h4 className="font-semibold">
                      {priorityAdvisory
                        ? 'Higher-scoring eligible members'
                        : `Other members have priority for ${priorityReview.specialty_label}`}
                    </h4>
                    <p className="mt-1">
                      {priorityAdvisory
                        ? 'Review these candidates. You can assign a related seat and leave A-Day due, or continue this bidder.'
                        : 'Offer these seats first. A-Day remains due at each member’s ordinary turn.'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {priorityReview.higher_priority_candidates.length} higher-priority members
                    </p>
                    <ol
                      aria-label="Higher-priority specialty candidates"
                      className="mt-2 space-y-1"
                    >
                      {priorityReview.higher_priority_candidates
                        .slice(0, 5)
                        .map(priorityCandidateRow)}
                    </ol>
                    {priorityReview.higher_priority_candidates.length > 5 ? (
                      <details className="mt-2 text-sm">
                        <summary className="min-h-11 cursor-pointer content-center font-medium">
                          Show all higher-priority members (
                          {priorityReview.higher_priority_candidates.length})
                        </summary>
                        <ol
                          aria-label="More higher-priority specialty candidates"
                          start={6}
                          className="max-h-60 space-y-1 overflow-y-auto"
                        >
                          {priorityReview.higher_priority_candidates
                            .slice(5)
                            .map(priorityCandidateRow)}
                        </ol>
                      </details>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!priorityAdvisory ? (
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (!priorityReview.specialty_id) return;
                            setSpecialtyId(priorityReview.specialty_id);
                            setPositionId(priorityReview.position_id);
                            void command('live.start_specialty_adjudication', {
                              specialtyId: priorityReview.specialty_id,
                              positionId: priorityReview.position_id,
                            });
                          }}
                        >
                          Offer specialty seats first
                        </Button>
                      ) : (
                        <details className="text-xs">
                          <summary className="min-h-11 cursor-pointer content-center">
                            Related eligible seats (
                            {priorityReview.eligible_related_position_ids.length})
                          </summary>
                          <p>
                            {priorityReview.eligible_related_position_ids
                              .map(
                                (id) =>
                                  `${id} · ${props.positions?.find((position) => position.id === id)?.positionName ?? 'Seat'}`,
                              )
                              .join(', ')}
                          </p>
                        </details>
                      )}
                      <Button
                        type="button"
                        onClick={() => {
                          setSelectionPositionId('');
                          setSelectionPoolId('');
                          setSelectionReview(null);
                        }}
                      >
                        Choose a different seat
                      </Button>
                    </div>
                  </>
                ) : prompt.result.status === 'NOT_CURRENT' ? (
                  <p>The bidder changed. Refresh and review the current turn.</p>
                ) : prompt.result.status === 'INELIGIBLE' ? (
                  <p>
                    This member is not eligible for this specialty. Choose another seat or use
                    Adjust bid.
                  </p>
                ) : (
                  <p>No higher-priority candidate is waiting for this specialty.</p>
                )}
              </section>
            ) : null}
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
                  {state.opportunity_pools
                    .filter(
                      (pool) =>
                        pool.resolvedPositionId !== null &&
                        state.selection_stage?.eligible_position_ids.includes(
                          pool.resolvedPositionId,
                        ),
                    )
                    .map((pool) => (
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
            {selectionRequiresSimultaneousADay && selectionPosition !== undefined ? (
              <ADayChoice
                label={
                  props.workspace && selectionPosition.shift === 'D'
                    ? 'Selection R-Day'
                    : 'Selection A-Day'
                }
                position={selectionPosition}
                combatGroups={state?.a_day_combat_groups}
                value={selectionADay}
                onChange={setSelectionADay}
                unavailable={selectionUnavailableADays}
              />
            ) : null}
            {(state?.membership_distributions ?? [])
              .filter(
                (entry) =>
                  entry.membershipSource === 'REVIEWED_QUALIFIED_POOL' &&
                  entry.memberIds.includes(selectionMember?.member_id ?? -1),
              )
              .map((entry) => (
                <Label key={entry.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      membershipChoice.memberId === selectionMember?.member_id &&
                      membershipChoice.ids.includes(entry.id)
                    }
                    onChange={(event) => {
                      const memberId = selectionMember?.member_id ?? null;
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
                authRefreshing ||
                authReviewRequired ||
                loadError !== null ||
                state === null ||
                state.current_phase === 'paused' ||
                state.active !== null ||
                selectionMember === null ||
                !canSelectViewedMember ||
                pendingADay !== null ||
                (needsSpecialtyReview &&
                  (prompt?.result == null ||
                    priorityReviewRequired ||
                    prompt.result.status === 'INELIGIBLE' ||
                    prompt.result.status === 'NOT_CURRENT')) ||
                !selectionPositionId ||
                (selectionRequiresSimultaneousADay &&
                  (!selectionADay || selectionUnavailableADays[selectionADay] !== undefined))
              }
              onClick={() =>
                void command('live.record_selection', {
                  memberId: selectionMember?.member_id,
                  positionId: selectionPositionId,
                  ...(selectionPoolId ? { pool: { poolId: selectionPoolId } } : {}),
                  ...(selectionRequiresSimultaneousADay ? { aDay: selectionADay } : {}),
                })
              }
              className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              {props.workspace ? 'Confirm bid' : 'Commit selection'}
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
              {filled
                .filter(([id]) => id === state?.amendable_selection?.from_position_id)
                .map(([id, memberId]) => (
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
                ?.filter(
                  (position) =>
                    !position.bidParticipation || position.bidParticipation === 'BIDDABLE',
                )
                ?.filter((position) =>
                  state?.amendable_selection?.eligible_position_ids.includes(position.id),
                )
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
                  {state.opportunity_pools
                    .filter(
                      (pool) =>
                        pool.resolvedPositionId !== null &&
                        state.amendable_selection?.eligible_position_ids.includes(
                          pool.resolvedPositionId,
                        ),
                    )
                    .map((pool) => (
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
            {amendmentRequiresSimultaneousADay ? (
              <ADayChoice
                label="Corrected selection A-Day"
                position={amendmentPosition}
                combatGroups={state?.a_day_combat_groups}
                value={amendADay}
                onChange={setAmendADay}
              />
            ) : null}
            <Button
              type="button"
              disabled={
                busy || !amendFrom || !amendTo || (amendmentRequiresSimultaneousADay && !amendADay)
              }
              onClick={() =>
                void command('live.amend_selection', {
                  memberId:
                    state === null
                      ? props.fills[amendFrom]?.memberId
                      : state.fills[amendFrom]?.member_id,
                  fromPositionId: amendFrom,
                  toPositionId: amendTo,
                  ...(amendPoolId ? { pool: { poolId: amendPoolId } } : {}),
                  ...(amendmentRequiresSimultaneousADay ? { aDay: amendADay } : {}),
                })
              }
              className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Amend opportunity
            </Button>
          </article>

          <article hidden={panel !== 'order'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Alter remaining order</h3>
            <p className="mt-2 text-sm text-warning">
              This changes the selection order. Every remaining turn is retained and the change is
              recorded.
            </p>
            <Label className="mt-3 block text-sm">
              Find member
              <Input
                type="search"
                aria-label="Find member in bid order"
                value={orderQuery}
                onChange={(event) => setOrderQuery(event.target.value)}
                className="mt-1"
              />
            </Label>
            {normalizedOrderQuery ? (
              <output className="mt-2 block text-xs text-muted-foreground">
                {visibleOrder.length === 0
                  ? 'No matching turns.'
                  : `${visibleOrder.length} of ${order.length} turns shown.`}
              </output>
            ) : null}
            <ol
              aria-label="Remaining bid turns"
              className="mt-2 max-h-[40dvh] space-y-1 overflow-y-auto"
            >
              {visibleOrder.map(({ memberId, occurrence, stage_label, index }) => (
                <li
                  key={`${memberId}-${occurrence}`}
                  className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-sm"
                >
                  <span className="mr-auto">
                    {index + 1}. {memberName(memberId)}
                    {stage_label ? ` · ${stage_label}` : ''}
                    {occurrence > 0 ? ` · turn ${occurrence + 1}` : ''}
                  </span>
                  <Button
                    type="button"
                    disabled={busy || index === 0}
                    aria-label={`Make ${memberName(memberId)} next${occurrence > 0 ? ` (turn ${occurrence + 1})` : ''}`}
                    onClick={() => move(index, -index)}
                  >
                    Make next
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || index === 0}
                    aria-label={`Move ${memberName(memberId)} up`}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || index === order.length - 1}
                    aria-label={`Move ${memberName(memberId)} down`}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                </li>
              ))}
            </ol>
            {state?.admin_override_allowed ? (
              <ReviewedBidAdjustment
                sessionId={props.bidSessionId}
                sequence={state.sequence}
                detail={{
                  type: 'live.alter_order',
                  orderedRemainingMemberIds: order.map((entry) => entry.memberId),
                  ...(state.remaining_turns
                    ? {
                        orderedRemainingTurns: order.map((entry) => ({
                          memberId: entry.memberId,
                          stageId: entry.stageId ?? null,
                        })),
                      }
                    : {}),
                }}
                reason={reason}
                disabled={
                  busy ||
                  order.length === 0 ||
                  loadError !== null ||
                  authRefreshing ||
                  authReviewRequired
                }
                label="Bid order"
                onSaved={() => {
                  void load().catch(() => setLoadError('Bid updates unavailable.'));
                  props.onCanonicalChange?.();
                }}
              />
            ) : (
              <Button
                type="button"
                disabled={busy || order.length === 0}
                onClick={() =>
                  void command('live.alter_order', {
                    orderedRemainingMemberIds: order.map((entry) => entry.memberId),
                    ...(state?.remaining_turns
                      ? {
                          orderedRemainingTurns: order.map((entry) => ({
                            memberId: entry.memberId,
                            stageId: entry.stageId ?? null,
                          })),
                        }
                      : {}),
                  })
                }
              >
                Save bid order
              </Button>
            )}
          </article>

          <article hidden={panel !== 'finalization'} className="rounded border border-border p-3">
            <h3 className="font-semibold text-foreground">Mark results ready for finalization</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This seals the completed canonical result for Results, exports, and the read-only
              staffing transition preview. It does not publish to Portal or change staffing.
            </p>
            {state?.completion_blockers?.length ? (
              <p className="mt-2 text-sm text-warning">
                Every participant needs a position or a disposition that ends their selection
                rights. Still unresolved:{' '}
                {state.completion_blockers.map((candidate) => name(candidate)).join(', ')}.
              </p>
            ) : null}
            <Button
              type="button"
              disabled={
                busy ||
                state?.current_phase !== 'complete' ||
                (state?.completion_blockers?.length ?? 0) > 0
              }
              onClick={() => void command('live.complete_session')}
              className="mt-2 rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Mark ready for finalization
            </Button>
          </article>
        </div>
      </SelectionFrame>
    </section>
  );
}
