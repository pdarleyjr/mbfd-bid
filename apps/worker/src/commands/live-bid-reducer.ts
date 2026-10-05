import type { Member } from '@mbfd/eligibility';
import type { FrozenLiveBidPolicy, LiveBidAction, LiveBidCommand } from '@mbfd/shared';
import { handleSubmitADayPick } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState, Fill, LiveBidProgress } from '../durable/bid-session-state.js';
import {
  type AdminBidOverrideWarning,
  addAdminBidOverrideWarning,
  hasAdminBidOverride,
} from '../lib/admin-bid-override.js';
import {
  type AnnualOperationsState,
  checkpointAnnualOperations,
  declareUnreachable,
  initializeAnnualOperations,
  markReadyForFinalization,
  recordContactAttempt,
  returnAtCurrentSequence,
  validateUnreachableContact,
} from '../lib/annual-bid-operations.js';
import { unresolvedBidCorrections } from '../lib/bid-corrections.js';
import {
  liveMemberHasOpenTurn,
  liveTurnIsCompleted,
  withdrawnLivePositionIds,
} from '../lib/live-bid-opportunities.js';
import { currentLiveBidStage, liveBidSelectionStages } from '../lib/live-bid-stages.js';

function settleReturnedMember(
  state: AnnualOperationsState,
  memberId: number,
): AnnualOperationsState {
  if (
    state.returningMemberId !== memberId &&
    !state.returnedAtCurrentSequence.some((entry) => entry.memberId === memberId)
  )
    return state;
  return {
    ...state,
    returnedAtCurrentSequence: state.returnedAtCurrentSequence.filter(
      (entry) => entry.memberId !== memberId,
    ),
    returningMemberId: state.returningMemberId === memberId ? null : state.returningMemberId,
  };
}

/** A successful award/A-Day resolves contact without erasing contact or
 * disposition evidence. An unavailable returned member is handled separately. */
function settleSelectedMember(
  state: AnnualOperationsState,
  memberId: number,
): AnnualOperationsState {
  const settled = settleReturnedMember(state, memberId);
  return settled.unresolvedMemberIds.includes(memberId)
    ? {
        ...settled,
        unresolvedMemberIds: settled.unresolvedMemberIds.filter((id) => id !== memberId),
      }
    : settled;
}

export type LiveReduction =
  | {
      ok: true;
      state: BidSessionState;
      eventType: 'live_command_applied';
      payload: Record<string, unknown>;
      supersedesBidId: string | null;
    }
  | { ok: false; code: string };

export function liveBidActionForCommand(command: LiveBidCommand): LiveBidAction {
  if (command.type === 'live.transition_stage') return 'approve_transition';
  if (hasAdminBidOverride(command)) return 'force';
  switch (command.type) {
    case 'live.record_selection':
      return 'record_selection';
    case 'live.amend_selection':
    case 'live.correct_bid':
      return 'amend_selection';
    case 'live.disposition':
      return command.disposition === 'UNREACHABLE' ? 'mark_unreachable' : 'skip_defer';
    case 'live.force_selection':
    case 'live.set_exceptional_assignment':
      return 'force';
    case 'live.record_a_day':
      return 'record_selection';
    case 'live.record_fallback_response':
      return command.outcome === 'UNREACHABLE' ? 'mark_unreachable' : 'skip_defer';
    case 'live.pause':
    case 'live.resume':
    case 'live.checkpoint':
      return 'pause_resume';
    case 'live.record_contact_attempt':
    case 'live.declare_unreachable':
      return 'mark_unreachable';
    case 'live.return_at_current_sequence':
      return 'skip_defer';
    case 'live.complete_session':
      return 'approve_final_results';
    case 'live.alter_order':
      return 'alter_order';
    case 'live.start_specialty_adjudication':
    case 'live.resolve_specialty_candidate':
    case 'live.close_specialty_adjudication':
      return 'approve_transition';
    case 'live.set_presentation_mode':
      return 'publish';
  }
}

function positionUsesDeferredADay(policy: FrozenLiveBidPolicy, positionId: string): boolean {
  const execution = policy.annualOperations?.aDay.execution;
  if (execution === undefined) return false;
  const matching = (execution.timingExceptions ?? []).filter((entry) =>
    entry.positionIds.includes(positionId),
  );
  if (matching.length > 1) return false;
  return (matching[0]?.timing ?? execution.timing) === 'AFTER_POSITION_SELECTION';
}

function memberHasDeferredOrdinaryTurn(
  state: BidSessionState,
  policy: FrozenLiveBidPolicy,
  memberId: number,
): boolean {
  if (!liveMemberHasOpenTurn(state, memberId)) return false;
  return Object.entries(state.fills).some(
    ([positionId, fill]) =>
      fill.memberId === memberId &&
      fill.aDay === undefined &&
      (positionUsesDeferredADay(policy, positionId) ||
        fill.aDayDeferral?.positionId === positionId),
  );
}

/** A repeated Days eligibility entry does not bring forward a combat member's
 * rank turn. A directed Days award can still retain its weekday choice. */
function deferredADayBelongsToTurn(
  state: BidSessionState,
  policy: FrozenLiveBidPolicy,
  memberId: number,
  stageId: string | null | undefined,
): boolean {
  if (policy.stages.find((stage) => stage.id === stageId)?.kind !== 'D_SHIFT') return true;
  const award = Object.entries(state.fills).find(([, fill]) => fill.memberId === memberId);
  return (
    award !== undefined &&
    policy.stages.some(
      (stage) => stage.kind === 'D_SHIFT' && stage.opportunityPositionIds.includes(award[0]),
    )
  );
}

function nextAvailableFrom(
  state: BidSessionState,
  policy: FrozenLiveBidPolicy,
  startIndex: number,
  now: number,
): Pick<BidSessionState, 'queueCursor' | 'currentBidderId' | 'currentPhase' | 'turnStartedAtMs'> {
  let queueCursor = startIndex;
  const selected = new Set(Object.values(state.fills).map((fill) => fill.memberId));
  const picked = new Set(state.aDay?.picks.map((pick) => pick.memberId) ?? []);
  while (state.bidOrder[queueCursor]) {
    const memberId = state.bidOrder[queueCursor]?.memberId ?? -1;
    if (liveTurnIsCompleted(state, state.bidOrder[queueCursor] ?? {})) {
      queueCursor += 1;
      continue;
    }
    if (
      state.live?.exceptionalAssignments?.some(
        (entry) => entry.memberId === memberId && entry.releasedAtMs === null,
      )
    ) {
      queueCursor += 1;
      continue;
    }
    if (!selected.has(memberId))
      return {
        queueCursor,
        currentBidderId: memberId,
        currentPhase: 'position_bid',
        turnStartedAtMs: now,
      };
    // An early award keeps its ordinary turn for the A-Day it could not select then.
    if (
      !picked.has(memberId) &&
      memberHasDeferredOrdinaryTurn(state, policy, memberId) &&
      deferredADayBelongsToTurn(state, policy, memberId, state.bidOrder[queueCursor]?.stageId)
    )
      return {
        queueCursor,
        currentBidderId: memberId,
        currentPhase: 'a_day_bid',
        turnStartedAtMs: now,
      };
    queueCursor += 1;
  }
  const pending = state.bidOrder.find(
    (candidate) =>
      !liveTurnIsCompleted(state, candidate) &&
      !picked.has(candidate.memberId) &&
      memberHasDeferredOrdinaryTurn(state, policy, candidate.memberId) &&
      deferredADayBelongsToTurn(state, policy, candidate.memberId, candidate.stageId),
  )?.memberId;
  return pending === undefined
    ? { queueCursor, currentBidderId: null, currentPhase: 'complete', turnStartedAtMs: 0 }
    : { queueCursor, currentBidderId: pending, currentPhase: 'a_day_bid', turnStartedAtMs: now };
}
function next(state: BidSessionState, policy: FrozenLiveBidPolicy, now: number) {
  return nextAvailableFrom(state, policy, state.queueCursor + 1, now);
}
/** An override/correction can satisfy the active deferred A-Day directly.
 * Resume the untouched ordinary queue rather than retaining a picked turn. */
export function advancePastResolvedLiveBidTurn(
  state: BidSessionState,
  policy: FrozenLiveBidPolicy,
  now: number,
) {
  return nextAvailableFrom(state, policy, state.queueCursor + 1, now);
}
function isOrdinaryADayTurn(state: BidSessionState, policy: FrozenLiveBidPolicy): boolean {
  return (
    state.currentPhase === 'a_day_bid' &&
    state.currentBidderId !== null &&
    state.bidOrder[state.queueCursor]?.memberId === state.currentBidderId &&
    memberHasDeferredOrdinaryTurn(state, policy, state.currentBidderId)
  );
}
function latestDispositionRule(
  live: LiveBidProgress,
  policy: FrozenLiveBidPolicy,
  memberId: number,
): FrozenLiveBidPolicy['dispositions'][number] | undefined {
  const latest = [...live.dispositions].reverse().find((entry) => entry.memberId === memberId);
  return latest === undefined
    ? undefined
    : policy.dispositions.find((rule) => rule.disposition === latest.disposition);
}
function hasAward(state: BidSessionState, memberId: number): boolean {
  return Object.values(state.fills).some((fill) => fill.memberId === memberId);
}
/** Frozen stage participants with neither an award nor a disposition ending their rights. */
export function participantCoverageGaps(
  state: BidSessionState,
  live: LiveBidProgress,
  policy: FrozenLiveBidPolicy,
  annual: AnnualOperationsState,
): number[] {
  const participants = [...new Set(policy.stages.flatMap((stage) => stage.memberIds))];
  return participants.filter((memberId) => {
    if (!liveMemberHasOpenTurn(state, memberId)) return false;
    if (
      live.exceptionalAssignments?.some(
        (entry) => entry.memberId === memberId && entry.releasedAtMs === null,
      )
    )
      return false;
    if (hasAward(state, memberId)) return false;
    if (annual.returningMemberId === memberId || annual.unresolvedMemberIds.includes(memberId))
      return true;
    const rule = latestDispositionRule(live, policy, memberId);
    return rule === undefined || (!rule.terminal && rule.retainsLaterSelectionRights);
  });
}
function stageFor(state: BidSessionState, policy: FrozenLiveBidPolicy): string | null {
  return currentLiveBidStage(state, policy)?.id ?? null;
}
function progress(state: BidSessionState, policy: FrozenLiveBidPolicy): LiveBidProgress {
  return (
    state.live ?? {
      currentStageId: stageFor(state, policy),
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    }
  );
}

export function reduceLiveBidCommand(
  state: BidSessionState,
  policy: FrozenLiveBidPolicy,
  command: LiveBidCommand,
  now: number,
  bidId: string,
  /** Supplied only by the canonical boundary after frozen fallback evaluation. */
  fallbackAuthorized = false,
  /** Loaded only by the canonical boundary from the immutable session snapshot. */
  aDayMembers?: readonly Member[],
): LiveReduction {
  const permitted = policy.actionPermissions.some(
    (grant) =>
      grant.action === liveBidActionForCommand(command) &&
      grant.actorMemberIds.includes(command.actor.id),
  );
  if (!permitted) return { ok: false, code: 'LIVE_ACTION_FORBIDDEN' };
  if (state.frozenAt !== null) return { ok: false, code: 'SESSION_FROZEN' };
  // `live.complete_session` seals the exact canonical result consumed by
  // Post-Bid. Receipt replay remains handled before reduction; a new command
  // must never mutate awards, A-Day, disposition, or staging afterwards.
  if (state.annual?.completion !== null && state.annual?.completion !== undefined)
    return { ok: false, code: 'ANNUAL_COMPLETION_SEALED' };
  if (command.type === 'live.complete_session' && unresolvedBidCorrections(state).length > 0)
    return { ok: false, code: 'UNRESOLVED_CORRECTIONS_BLOCK_COMPLETION' };
  if (
    (command.type === 'live.record_selection' ||
      command.type === 'live.force_selection' ||
      (command.type === 'live.resolve_specialty_candidate' && command.outcome === 'ACCEPT')) &&
    unresolvedBidCorrections(state).some((entry) => entry.before.fill.memberId === command.memberId)
  )
    return { ok: false, code: 'CORRECTION_REPLACEMENT_REQUIRED' };
  const live = progress(state, policy);
  const currentStageId = stageFor(state, policy);
  const annual = state.annual ?? initializeAnnualOperations({ preferenceSheets: [] });
  const administratorOverride = hasAdminBidOverride(command);
  const overrideWarnings: AdminBidOverrideWarning[] = [];
  const overridePayload = () => ({
    reason: command.reason,
    warnings: overrideWarnings,
    warningCodes: overrideWarnings.map((warning) => warning.code),
  });
  const targetPositionId =
    command.type === 'live.correct_bid'
      ? command.replacement?.positionId
      : command.type === 'live.amend_selection'
        ? command.toPositionId
        : command.type === 'live.resolve_specialty_candidate' && command.outcome === 'ACCEPT'
          ? (command.positionId ?? live.specialty?.positionId)
          : 'positionId' in command
            ? command.positionId
            : undefined;
  if (targetPositionId != null && withdrawnLivePositionIds(state).has(targetPositionId))
    return { ok: false, code: 'POSITION_WITHDRAWN' };
  if (administratorOverride) {
    const executionPhase = state.currentPhase === 'paused' ? live.pausedPhase : state.currentPhase;
    if (!['position_bid', 'a_day_bid', 'complete'].includes(executionPhase ?? ''))
      return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (state.currentPhase !== 'position_bid')
      addAdminBidOverrideWarning(
        overrideWarnings,
        'PHASE_DEVIATION',
        `This action occurs during ${state.currentPhase}; it does not change the frozen policy.`,
      );
    if (live.specialty != null)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'SPECIALTY_INTERRUPTION',
        'This action closes the active specialty interruption; its candidate evidence and pending ordinary turns remain recorded.',
      );
  }
  if (currentStageId === null || !policy.stages.some((stage) => stage.id === currentStageId))
    return { ok: false, code: 'LIVE_STAGE_POLICY_INCOMPLETE' };
  if (command.type === 'live.set_exceptional_assignment') {
    if (
      !administratorOverride &&
      !['position_bid', 'a_day_bid', 'complete'].includes(state.currentPhase)
    )
      return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (!administratorOverride && live.specialty)
      return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
    const existingAward = Object.entries(state.fills).find(
      ([, fill]) => fill.memberId === command.memberId,
    );
    if (!administratorOverride && existingAward)
      return { ok: false, code: 'EXCEPTIONAL_ASSIGNMENT_EXISTING_AWARD' };
    if (existingAward)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'EXISTING_AWARD_RETAINED',
        `The member keeps ${existingAward[0]} and its A-Day. This duty is a separate session assignment; changing the seat requires an explicit correction.`,
      );
    const assignments = live.exceptionalAssignments ?? [];
    const active = assignments.find(
      (entry) => entry.memberId === command.memberId && entry.releasedAtMs === null,
    );
    if (command.operation === 'ASSIGN' && active)
      return { ok: false, code: 'EXCEPTIONAL_ASSIGNMENT_ALREADY_ACTIVE' };
    if (command.operation === 'RELEASE' && (!active || active.roleLabel !== command.roleLabel))
      return { ok: false, code: 'EXCEPTIONAL_ASSIGNMENT_NOT_ACTIVE' };
    if (
      command.operation === 'ASSIGN' &&
      assignments.some(
        (entry) =>
          entry.releasedAtMs === null &&
          (entry.roleLabel === command.roleLabel ||
            (command.positionId !== undefined && entry.positionId === command.positionId)),
      )
    )
      return { ok: false, code: 'EXCEPTIONAL_ASSIGNMENT_ROLE_OCCUPIED' };
    const updatedAssignments =
      command.operation === 'ASSIGN'
        ? [
            ...assignments,
            {
              assignmentId: bidId,
              commandId: command.commandId,
              memberId: command.memberId,
              roleLabel: command.roleLabel,
              positionId: command.positionId ?? null,
              actorMemberId: command.actor.id,
              reason: command.reason,
              assignedAtMs: now,
              releasedAtMs: null,
              releaseCommandId: null,
            },
          ]
        : assignments.map((entry) =>
            entry === active
              ? { ...entry, releasedAtMs: now, releaseCommandId: command.commandId }
              : entry,
          );
    let result: BidSessionState = {
      ...state,
      live: {
        ...live,
        exceptionalAssignments: updatedAssignments,
        ...(administratorOverride && live.specialty != null ? { specialty: null } : {}),
      },
      annual: settleSelectedMember(annual, command.memberId),
      lastSeq: state.lastSeq + 1,
    };
    if (command.operation === 'ASSIGN' && state.currentBidderId === command.memberId) {
      const advance = nextAvailableFrom(result, policy, state.queueCursor + 1, now);
      result = {
        ...result,
        ...advance,
        ...(state.currentPhase === 'paused'
          ? {
              currentPhase: 'paused' as const,
              live: { ...(result.live ?? live), pausedPhase: advance.currentPhase },
            }
          : {}),
      };
    }
    if (command.operation === 'RELEASE') {
      if (!state.bidOrder.some((entry) => entry.memberId === command.memberId))
        return { ok: false, code: 'EXCEPTIONAL_ASSIGNMENT_PARTICIPANT_MISSING' };
      const ordinaryTurnPending = state.bidOrder
        .slice(state.queueCursor)
        .some(
          (entry) =>
            entry.memberId === command.memberId &&
            policy.stages.find((stage) => stage.id === entry.stageId)?.kind !== 'D_SHIFT',
        );
      if (!existingAward && (!ordinaryTurnPending || state.currentPhase === 'complete')) {
        // An already-passed rank turn returns at the current sequence. Reusing
        // the first queue entry would incorrectly rewind a Captain into Days.
        const returned = returnAtCurrentSequence(result.annual ?? annual, {
          memberId: command.memberId,
          sequence: result.lastSeq,
          retainsSelectionRights: true,
        });
        if (!returned.ok) return returned;
        result = { ...result, annual: returned.state };
      }
    }
    return {
      ok: true,
      state: result,
      eventType: 'live_command_applied',
      payload: {
        operation: 'set_exceptional_assignment',
        assignmentOperation: command.operation,
        memberId: command.memberId,
        roleLabel: command.roleLabel,
        positionId: command.positionId ?? null,
        forced: true,
        officialRankUnchanged: true,
        staffingWriteback: false,
        ...(administratorOverride ? { adminOverride: overridePayload() } : {}),
        ...(administratorOverride && live.specialty != null
          ? { interruptedSpecialty: live.specialty }
          : {}),
        nextMemberId: result.currentBidderId,
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.pause') {
    if (state.currentPhase === 'paused') return { ok: false, code: 'SESSION_PAUSED' };
    return {
      ok: true,
      state: {
        ...state,
        currentPhase: 'paused',
        turnPausedAtMs: now,
        live: { ...live, pausedPhase: state.currentPhase },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'pause',
        stageId: currentStageId,
        turnPausedAtMs: now,
        turnStartedAtMs: state.turnStartedAtMs,
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.resume') {
    if (state.currentPhase !== 'paused' || live.pausedPhase === null)
      return { ok: false, code: 'SESSION_NOT_PAUSED' };
    // Move only the advisory clock. A saved pause instant excludes an overnight
    // interval without changing any bidder, queue, award or pending context.
    // Historical paused states lack that instant and receive a fresh clock.
    // A reviewed action may start another turn while paused; in that case its
    // start is after the pause instant and the next bidder keeps the full time.
    const elapsedMs =
      state.turnStartedAtMs <= 0 ||
      state.turnPausedAtMs === undefined ||
      state.turnPausedAtMs === null
        ? 0
        : Math.min(
            state.turnTimerSeconds * 1000,
            Math.max(0, state.turnPausedAtMs - state.turnStartedAtMs),
          );
    const hasTurn = state.turnStartedAtMs > 0 || state.currentBidderId !== null;
    const resumedTurnStartedAtMs = hasTurn ? Math.max(0, now - elapsedMs) : 0;
    return {
      ok: true,
      state: {
        ...state,
        currentPhase: live.pausedPhase,
        turnPausedAtMs: null,
        turnStartedAtMs: resumedTurnStartedAtMs,
        live: { ...live, pausedPhase: null },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'resume',
        stageId: currentStageId,
        turnPausedAtMs: null,
        turnStartedAtMs: resumedTurnStartedAtMs,
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.record_a_day') {
    if (aDayMembers === undefined) return { ok: false, code: 'FROZEN_A_DAY_POLICY_UNAVAILABLE' };
    if (administratorOverride) {
      const award = Object.entries(state.fills).find(
        ([, fill]) => fill.memberId === command.memberId,
      );
      if (!award) return { ok: false, code: 'A_DAY_ASSIGNMENT_INVALID' };
      const previousADay =
        state.aDay?.picks.find((pick) => pick.memberId === command.memberId)?.aDay ??
        award[1].aDay ??
        null;
      addAdminBidOverrideWarning(
        overrideWarnings,
        previousADay === null ? 'A_DAY_TIMING_DEVIATION' : 'A_DAY_CHANGE',
        previousADay === null
          ? 'The A-Day is selected by administrator direction instead of the ordinary turn.'
          : `The recorded A-Day changes from ${previousADay} to ${command.aDay}. The prior choice remains in the audit.`,
      );
      const { aDayOverride: _oldOverride, aDayDeferral: _oldDeferral, ...preserved } = award[1];
      return {
        ok: true,
        state: {
          ...state,
          fills: { ...state.fills, [award[0]]: { ...preserved, aDay: command.aDay } },
          aDay:
            state.aDay === null
              ? null
              : {
                  ...state.aDay,
                  picks: state.aDay.picks.filter((pick) => pick.memberId !== command.memberId),
                },
          annual: settleSelectedMember(annual, command.memberId),
          live: { ...live, ...(live.specialty != null ? { specialty: null } : {}) },
          lastSeq: state.lastSeq + 1,
        },
        eventType: 'live_command_applied',
        payload: {
          operation: 'record_a_day',
          memberId: command.memberId,
          positionId: award[0],
          aDay: command.aDay,
          before: { aDay: previousADay },
          after: { aDay: command.aDay },
          adminOverride: overridePayload(),
          ...(live.specialty != null ? { interruptedSpecialty: live.specialty } : {}),
        },
        supersedesBidId: null,
      };
    }
    const picked = handleSubmitADayPick(
      state,
      {
        senderMemberId: command.memberId,
        aDay: command.aDay,
        idempotencyKey: command.commandId,
        members: aDayMembers,
      },
      now,
    );
    if (picked.kind === 'rejected') return { ok: false, code: picked.code };
    const settledAnnual = settleSelectedMember(annual, command.memberId);
    const pickedState =
      settledAnnual === annual ? picked.newState : { ...picked.newState, annual: settledAnnual };
    const resumedState = isOrdinaryADayTurn(state, policy)
      ? {
          ...pickedState,
          ...nextAvailableFrom(pickedState, policy, state.queueCursor + 1, now),
        }
      : pickedState;
    return {
      ok: true,
      state: resumedState,
      eventType: 'live_command_applied',
      payload: {
        operation: 'record_a_day',
        memberId: command.memberId,
        aDay: command.aDay,
        nextMemberId: resumedState.currentBidderId,
        completed: resumedState.currentPhase === 'complete',
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.transition_stage') {
    const target = policy.stages.find((stage) => stage.id === command.stageId);
    const currentStage = policy.stages.find((stage) => stage.id === currentStageId);
    if (
      !target ||
      !currentStage ||
      target.order < currentStage.order ||
      live.completedStageIds.includes(target.id)
    )
      return { ok: false, code: 'INVALID_STAGE_TRANSITION' };
    if (state.currentPhase === 'config') return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (live.specialty != null) return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
    const withdraw = command.withdrawOpenPositionIds ?? [];
    const restore = command.restoreOpenPositionIds ?? [];
    const configurationRequested =
      command.completePriorStages === true || withdraw.length > 0 || restore.length > 0;
    if (configurationRequested && !administratorOverride)
      return { ok: false, code: 'ADMIN_STAGE_ADJUSTMENT_REVIEW_REQUIRED' };
    if (new Set(withdraw).size !== withdraw.length || new Set(restore).size !== restore.length)
      return { ok: false, code: 'POSITION_CONFIGURATION_DUPLICATE' };
    if (withdraw.some((id) => restore.includes(id)))
      return { ok: false, code: 'POSITION_WITHDRAWAL_RESTORATION_CONFLICT' };
    const biddable = new Set(policy.stages.flatMap((stage) => stage.opportunityPositionIds));
    const withdrawn = new Set(live.withdrawnPositionIds ?? []);
    for (const id of [...withdraw, ...restore]) {
      if (!biddable.has(id)) return { ok: false, code: 'OPPORTUNITY_NOT_BIDDABLE' };
      if (state.fills[id] !== undefined) return { ok: false, code: 'POSITION_FILLED' };
    }
    if (withdraw.some((id) => withdrawn.has(id)))
      return { ok: false, code: 'POSITION_ALREADY_WITHDRAWN' };
    if (restore.some((id) => !withdrawn.has(id)))
      return { ok: false, code: 'POSITION_NOT_WITHDRAWN' };
    const completed = new Set(live.completedStageIds);
    if (target.order > currentStage.order) completed.add(currentStageId);
    if (command.completePriorStages)
      for (const stage of [...policy.stages].sort((left, right) => left.order - right.order))
        if (stage.order < target.order) completed.add(stage.id);
    const newlyCompletedStageIds = [...completed].filter(
      (id) => !live.completedStageIds.includes(id),
    );
    if (
      target.id === currentStageId &&
      !newlyCompletedStageIds.length &&
      !withdraw.length &&
      !restore.length
    )
      return { ok: false, code: 'NO_STAGE_CONFIGURATION_CHANGE' };
    for (const id of withdraw) withdrawn.add(id);
    for (const id of restore) withdrawn.delete(id);
    let configured = {
      ...state,
      live: { ...live, completedStageIds: [...completed], withdrawnPositionIds: [...withdrawn] },
    };
    if (
      configured.annual?.returningMemberId != null &&
      !liveMemberHasOpenTurn(configured, configured.annual.returningMemberId)
    )
      configured = { ...configured, annual: { ...configured.annual, returningMemberId: null } };
    const index = state.bidOrder.findIndex((entry) => entry.stageId === target.id);
    if (index < 0) return { ok: false, code: 'LIVE_STAGE_POLICY_INCOMPLETE' };
    const advance =
      target.id === currentStageId && newlyCompletedStageIds.length === 0
        ? {
            queueCursor: state.queueCursor,
            currentBidderId: state.currentBidderId,
            currentPhase:
              state.currentPhase === 'paused'
                ? (live.pausedPhase ?? ('position_bid' as const))
                : state.currentPhase,
            turnStartedAtMs: state.turnStartedAtMs,
          }
        : nextAvailableFrom(
            configured,
            policy,
            target.id === currentStageId ? state.queueCursor : Math.max(state.queueCursor, index),
            now,
          );
    if (newlyCompletedStageIds.length && administratorOverride)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'STAGE_COMPLETION',
        'Earlier stages are complete for this session. Their recorded seats and unknown A-Day evidence remain unchanged.',
      );
    if (withdraw.length)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'OPPORTUNITY_WITHDRAWAL',
        `Withdraw ${withdraw.join(', ')} from this session. Existing selections and the frozen definition remain unchanged.`,
      );
    if (restore.length)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'OPPORTUNITY_RESTORATION',
        `Restore ${restore.join(', ')} as open opportunities in this session.`,
      );
    return {
      ok: true,
      state: {
        ...configured,
        ...advance,
        live: {
          ...configured.live,
          currentStageId: state.bidOrder[advance.queueCursor]?.stageId ?? target.id,
          ...(state.currentPhase === 'paused' ? { pausedPhase: advance.currentPhase } : {}),
        },
        ...(state.currentPhase === 'paused' ? { currentPhase: 'paused' as const } : {}),
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'transition_stage',
        fromStageId: currentStageId,
        stageId: target.id,
        completedStageIds: newlyCompletedStageIds,
        withdrawnPositionIds: withdraw,
        restoredPositionIds: restore,
        nextMemberId: advance.currentBidderId,
        ...(administratorOverride ? { adminOverride: overridePayload() } : {}),
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.set_presentation_mode') {
    const heldProjection =
      command.mode === 'HOLD'
        ? {
            currentBidderId: state.currentBidderId,
            currentStageId,
            currentPhase: state.currentPhase,
            fills: { ...state.fills },
            bidOrder: [...state.bidOrder],
            queueCursor: state.queueCursor,
            specialty: live.specialty ?? null,
            aDay: state.aDay,
            exceptionalAssignments: live.exceptionalAssignments ?? [],
            dispositions: live.dispositions,
            completedStageIds: [...live.completedStageIds],
            withdrawnPositionIds: [...(live.withdrawnPositionIds ?? [])],
            returningMemberId: state.annual?.returningMemberId ?? null,
          }
        : null;
    return {
      ok: true,
      state: {
        ...state,
        live: {
          ...live,
          presentation: {
            mode: command.mode,
            heldAtSeq: command.mode === 'HOLD' ? state.lastSeq : null,
            heldProjection,
          },
        },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: { operation: 'set_presentation_mode', mode: command.mode },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.alter_order') {
    if (!administratorOverride && state.currentPhase !== 'position_bid')
      return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (!administratorOverride && live.specialty !== null && live.specialty !== undefined)
      return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
    const committed = state.bidOrder.slice(0, state.queueCursor);
    const remainingTail = state.bidOrder.slice(state.queueCursor);
    const remaining = remainingTail.filter((entry) => !liveTurnIsCompleted(state, entry));
    const supplied = command.orderedRemainingMemberIds;
    const remainingCounts = new Map<number, number>();
    const suppliedCounts = new Map<number, number>();
    for (const entry of remaining)
      remainingCounts.set(entry.memberId, (remainingCounts.get(entry.memberId) ?? 0) + 1);
    for (const memberId of supplied)
      suppliedCounts.set(memberId, (suppliedCounts.get(memberId) ?? 0) + 1);
    if (
      supplied.length !== remaining.length ||
      remainingCounts.size !== suppliedCounts.size ||
      [...remainingCounts].some(([memberId, count]) => suppliedCounts.get(memberId) !== count)
    ) {
      return { ok: false, code: 'ALTER_ORDER_MEMBER_SET_MISMATCH' };
    }
    const suppliedTurns = command.orderedRemainingTurns;
    if (
      suppliedTurns !== undefined &&
      (suppliedTurns.length !== supplied.length ||
        suppliedTurns.some((turn, index) => turn.memberId !== supplied[index]))
    )
      return { ok: false, code: 'ALTER_ORDER_TURN_IDS_MISMATCH' };
    const turnKey = (entry: { memberId: number; stageId?: string | null }) =>
      JSON.stringify([entry.memberId, entry.stageId ?? null]);
    const key = (entry: { memberId: number; stageId?: string | null }) =>
      suppliedTurns === undefined ? String(entry.memberId) : turnKey(entry);
    const byTurn = new Map<string, typeof remaining>();
    for (const entry of remaining) {
      const identity = key(entry);
      const entries = byTurn.get(identity) ?? [];
      entries.push(entry);
      byTurn.set(identity, entries);
    }
    const reordered = (suppliedTurns ?? supplied.map((memberId) => ({ memberId }))).map((turn) =>
      byTurn.get(key(turn))?.shift(),
    );
    if (reordered.some((entry) => entry === undefined))
      return {
        ok: false,
        code:
          suppliedTurns === undefined
            ? 'ALTER_ORDER_MEMBER_SET_MISMATCH'
            : 'ALTER_ORDER_TURN_SET_MISMATCH',
      };
    const stageOrder = new Map(policy.stages.map((stage) => [stage.id, stage.order]));
    let priorStageOrder = Number.NEGATIVE_INFINITY;
    for (const entry of reordered) {
      const order = entry?.stageId === undefined ? undefined : stageOrder.get(entry.stageId ?? '');
      if (order === undefined || (!administratorOverride && order < priorStageOrder))
        return { ok: false, code: 'ALTER_ORDER_STAGE_SEQUENCE_INVALID' };
      if (order < priorStageOrder)
        addAdminBidOverrideWarning(
          overrideWarnings,
          'STAGE_DEVIATION',
          'The remaining order crosses the frozen rank or stage sequence. Every pending turn is retained.',
        );
      priorStageOrder = order;
    }
    const beforeMemberIds = remaining.map((entry) => entry.memberId);
    const mergedRemaining: typeof remaining = [];
    let editableCursor = 0;
    for (const entry of remainingTail) {
      if (liveTurnIsCompleted(state, entry)) mergedRemaining.push(entry);
      else {
        const replacement = reordered[editableCursor++];
        if (replacement === undefined) return { ok: false, code: 'ALTER_ORDER_TURN_SET_MISMATCH' };
        mergedRemaining.push(replacement);
      }
    }
    const bidOrder = [...committed, ...mergedRemaining];
    if (administratorOverride)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'ORDER_DEVIATION',
        'The administrator changes the remaining selection order. Recorded awards and pending selection rights are retained.',
      );
    const advance =
      administratorOverride || remainingTail.some((entry) => liveTurnIsCompleted(state, entry))
        ? nextAvailableFrom({ ...state, bidOrder }, policy, state.queueCursor, now)
        : null;
    return {
      ok: true,
      state: {
        ...state,
        bidOrder,
        currentBidderId: bidOrder[state.queueCursor]?.memberId ?? null,
        turnStartedAtMs: now,
        ...advance,
        ...(administratorOverride
          ? {
              live: {
                ...live,
                currentStageId:
                  bidOrder[advance?.queueCursor ?? state.queueCursor]?.stageId ?? currentStageId,
                ...(live.specialty != null ? { specialty: null } : {}),
                ...(state.currentPhase === 'paused' && advance
                  ? { pausedPhase: advance.currentPhase }
                  : {}),
              },
              ...(state.currentPhase === 'paused' ? { currentPhase: 'paused' as const } : {}),
            }
          : {}),
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'alter_order',
        beforeMemberIds,
        afterMemberIds: supplied,
        beforeTurns: remaining.map((entry) => ({
          memberId: entry.memberId,
          stageId: entry.stageId ?? null,
        })),
        afterTurns: reordered.map((entry) => ({
          memberId: entry?.memberId,
          stageId: entry?.stageId ?? null,
        })),
        ...(administratorOverride ? { adminOverride: overridePayload() } : {}),
        ...(administratorOverride && live.specialty != null
          ? { interruptedSpecialty: live.specialty }
          : {}),
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.start_specialty_adjudication') {
    if (state.currentPhase !== 'position_bid') return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (state.currentBidderId === null) return { ok: false, code: 'NO_CURRENT_BIDDER' };
    if (live.specialty !== null && live.specialty !== undefined)
      return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
    const specialty = policy.annualOperations?.specialties?.find(
      (entry) => entry.id === command.specialtyId,
    );
    if (specialty === undefined) return { ok: false, code: 'LIVE_SPECIALTY_POLICY_MISSING' };
    if (!specialty.opportunityPositionIds.includes(command.positionId))
      return { ok: false, code: 'SPECIALTY_POSITION_NOT_CONFIGURED' };
    if (state.fills[command.positionId] !== undefined)
      return { ok: false, code: 'POSITION_FILLED' };
    if (new Set(command.candidateMemberIds).size !== command.candidateMemberIds.length)
      return { ok: false, code: 'SPECIALTY_CANDIDATE_ORDER_INVALID' };
    return {
      ok: true,
      state: {
        ...state,
        live: {
          ...live,
          specialty: {
            specialtyId: specialty.id,
            positionId: command.positionId,
            suspendedBidderId: state.currentBidderId,
            candidateMemberIds: command.candidateMemberIds,
            candidateCursor: 0,
          },
        },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'start_specialty_adjudication',
        specialtyId: specialty.id,
        positionId: command.positionId,
        suspendedBidderId: state.currentBidderId,
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.resolve_specialty_candidate') {
    const specialty = live.specialty;
    if (specialty === null || specialty === undefined)
      return { ok: false, code: 'NO_ACTIVE_SPECIALTY_ADJUDICATION' };
    const expectedCandidateId = specialty.candidateMemberIds[specialty.candidateCursor];
    if (expectedCandidateId !== command.memberId)
      return { ok: false, code: 'SPECIALTY_CANDIDATE_OUT_OF_ORDER' };
    if (command.outcome !== 'ACCEPT') {
      const disposition = command.outcome === 'DECLINE' ? 'DECLINED' : command.outcome;
      const rule = policy.dispositions.find((candidate) => candidate.disposition === disposition);
      if (rule === undefined) return { ok: false, code: 'LIVE_DISPOSITION_POLICY_INCOMPLETE' };
      if (rule.requiresEvidence && command.evidenceReference === null)
        return { ok: false, code: 'DISPOSITION_EVIDENCE_REQUIRED' };
      if (command.outcome === 'UNREACHABLE') {
        const contact = validateUnreachableContact(
          state.annual ?? initializeAnnualOperations({ preferenceSheets: [] }),
          policy.annualOperations,
          { memberId: command.memberId, nowMs: now },
        );
        if (!contact.ok) return contact;
      }
    }
    if (command.outcome === 'ACCEPT') {
      const positionId = command.positionId ?? specialty.positionId;
      const specialtyPolicy = policy.annualOperations?.specialties?.find(
        (entry) => entry.id === specialty.specialtyId,
      );
      if (!specialtyPolicy?.opportunityPositionIds.includes(positionId))
        return { ok: false, code: 'SPECIALTY_POSITION_NOT_CONFIGURED' };
      if (state.fills[positionId] !== undefined) return { ok: false, code: 'POSITION_FILLED' };
      if (command.aDay !== undefined && positionUsesDeferredADay(policy, positionId))
        return { ok: false, code: 'A_DAY_DEFERRED_SELECTION_REQUIRED' };
      const existingFills = Object.entries(state.fills).filter(
        ([, candidateFill]) => candidateFill.memberId === command.memberId,
      );
      if (existingFills.length > 1)
        return { ok: false, code: 'SPECIALTY_CANDIDATE_FILL_AMBIGUOUS' };
      const prior = existingFills[0];
      const fill: Fill = {
        ...(command.aDay === undefined ? {} : { aDay: command.aDay }),
        memberId: command.memberId,
        ordinal:
          prior?.[1].ordinal ??
          state.bidOrder.find((entry) => entry.memberId === command.memberId)?.ordinal ??
          0,
        bidId,
      };
      const fills = { ...state.fills };
      if (prior !== undefined) delete fills[prior[0]];
      fills[positionId] = fill;
      const candidateOrderIndex = state.bidOrder.findIndex(
        (entry) => entry.memberId === command.memberId,
      );
      const removeFromRemainingOrder =
        prior === undefined &&
        candidateOrderIndex >= state.queueCursor &&
        !positionUsesDeferredADay(policy, positionId);
      const bidOrder = removeFromRemainingOrder
        ? state.bidOrder.filter((entry) => entry.memberId !== command.memberId)
        : state.bidOrder;
      const nextCursor = specialty.candidateCursor + 1;
      const continues =
        nextCursor < specialty.candidateMemberIds.length &&
        specialtyPolicy.opportunityPositionIds.some(
          (id) => fills[id] === undefined && !withdrawnLivePositionIds(state).has(id),
        );
      return {
        ok: true,
        state: {
          ...state,
          fills,
          bidOrder,
          live: {
            ...live,
            specialty: continues ? { ...specialty, candidateCursor: nextCursor } : null,
          },
          lastSeq: state.lastSeq + 1,
        },
        eventType: 'live_command_applied',
        payload: {
          operation: 'resolve_specialty_candidate',
          bidId,
          specialtyId: specialty.specialtyId,
          positionId,
          requestedPositionId: specialty.positionId,
          memberId: command.memberId,
          outcome: command.outcome,
          resumedBidderId: specialty.suspendedBidderId,
          reviewContinues: continues,
          releasedPositionId: prior?.[0] ?? null,
          supersedesBidId: prior?.[1].bidId ?? null,
          replacementBidId: prior === undefined ? null : bidId,
          removedFromRemainingOrder: removeFromRemainingOrder,
        },
        supersedesBidId: prior?.[1].bidId ?? null,
      };
    }
    const nextCursor = specialty.candidateCursor + 1;
    return {
      ok: true,
      state: {
        ...state,
        live: {
          ...live,
          specialtyResponses: [
            ...(live.specialtyResponses ?? []),
            {
              specialtyId: specialty.specialtyId,
              positionId: specialty.positionId,
              requesterMemberId: specialty.suspendedBidderId,
              memberId: command.memberId,
              outcome: command.outcome,
              reason: command.reason,
              evidenceReference: command.evidenceReference,
            },
          ],
          specialty:
            nextCursor < specialty.candidateMemberIds.length
              ? { ...specialty, candidateCursor: nextCursor }
              : null,
        },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'resolve_specialty_candidate',
        specialtyId: specialty.specialtyId,
        positionId: specialty.positionId,
        memberId: command.memberId,
        outcome: command.outcome,
        resumedBidderId:
          nextCursor < specialty.candidateMemberIds.length ? null : specialty.suspendedBidderId,
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.close_specialty_adjudication') {
    if (!live.specialty) return { ok: false, code: 'NO_ACTIVE_SPECIALTY_ADJUDICATION' };
    return {
      ok: true,
      state: { ...state, live: { ...live, specialty: null }, lastSeq: state.lastSeq + 1 },
      eventType: 'live_command_applied',
      payload: {
        operation: 'close_specialty_adjudication',
        specialtyId: live.specialty.specialtyId,
        positionId: live.specialty.positionId,
        resumedBidderId: live.specialty.suspendedBidderId,
        unresolvedCandidateIds: live.specialty.candidateMemberIds.slice(
          live.specialty.candidateCursor,
        ),
        specialtyRightsPreserved: true,
      },
      supersedesBidId: null,
    };
  }
  const annualPolicy = policy.annualOperations;
  if (command.type === 'live.record_fallback_response') {
    if (!fallbackAuthorized) return { ok: false, code: 'FALLBACK_REVIEW_REQUIRED' };
    if (state.currentPhase !== 'position_bid' && state.currentPhase !== 'complete')
      return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (live.specialty) return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
    const disposition = command.outcome === 'DECLINE' ? 'DECLINED' : command.outcome;
    const rule = policy.dispositions.find((candidate) => candidate.disposition === disposition);
    if (!rule) return { ok: false, code: 'LIVE_DISPOSITION_POLICY_INCOMPLETE' };
    // Evidence requirements are distinct from an optional operator note.
    if (rule.requiresEvidence && command.evidenceReference === null)
      return { ok: false, code: 'DISPOSITION_EVIDENCE_REQUIRED' };
    if (command.outcome === 'UNREACHABLE') {
      const contact = validateUnreachableContact(annual, annualPolicy, {
        memberId: command.memberId,
        nowMs: now,
      });
      if (!contact.ok) return contact;
    }
    const response = {
      ...command.fallback,
      positionId: command.positionId,
      memberId: command.memberId,
      outcome: command.outcome,
      reason: command.reason,
      evidenceReference: command.evidenceReference,
    };
    return {
      ok: true,
      state: {
        ...state,
        live: { ...live, fallbackResponses: [...(live.fallbackResponses ?? []), response] },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: { operation: 'record_fallback_response', ...response },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.record_contact_attempt') {
    const result = recordContactAttempt(annual, {
      memberId: command.memberId,
      method: command.method,
      actorMemberId: command.actor.id,
      atMs: now,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      state: { ...state, annual: result.state, lastSeq: state.lastSeq + 1 },
      eventType: 'live_command_applied',
      payload: {
        operation: 'record_contact_attempt',
        memberId: command.memberId,
        method: command.method,
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.declare_unreachable') {
    if (
      hasAward(state, command.memberId) &&
      (!memberHasDeferredOrdinaryTurn(state, policy, command.memberId) ||
        state.aDay?.picks.some((pick) => pick.memberId === command.memberId))
    )
      return { ok: false, code: 'MEMBER_ALREADY_SELECTED' };
    const result = declareUnreachable(annual, annualPolicy, {
      memberId: command.memberId,
      actorMemberId: command.actor.id,
      nowMs: now,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      state: { ...state, annual: result.state, lastSeq: state.lastSeq + 1 },
      eventType: 'live_command_applied',
      payload: { operation: 'declare_unreachable', memberId: command.memberId },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.return_at_current_sequence') {
    if (hasAward(state, command.memberId)) return { ok: false, code: 'MEMBER_NOT_UNRESOLVED' };
    const result = returnAtCurrentSequence(annual, {
      memberId: command.memberId,
      sequence: state.lastSeq,
      retainsSelectionRights:
        !hasAward(state, command.memberId) &&
        latestDispositionRule(live, policy, command.memberId)?.retainsLaterSelectionRights === true,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      state: {
        ...state,
        annual: result.state,
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: { operation: 'return_at_current_sequence', memberId: command.memberId },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.checkpoint') {
    return {
      ok: true,
      state: {
        ...state,
        annual: checkpointAnnualOperations(annual, {
          name: command.name,
          actorMemberId: command.actor.id,
          createdAtMs: now,
          sequence: state.lastSeq + 1,
        }),
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: { operation: 'checkpoint', name: command.name },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.complete_session') {
    if (state.currentPhase !== 'complete') return { ok: false, code: 'SESSION_NOT_COMPLETE' };
    if (annualPolicy === undefined) return { ok: false, code: 'ANNUAL_OPERATIONS_POLICY_MISSING' };
    if (
      annual.unresolvedMemberIds.length === 0 &&
      participantCoverageGaps(state, live, policy, annual).length > 0
    )
      return { ok: false, code: 'PARTICIPANT_COVERAGE_INCOMPLETE' };
    const settledReturnMemberId = annual.returningMemberId;
    const settledAnnual: AnnualOperationsState = {
      ...annual,
      returnedAtCurrentSequence: [],
      returningMemberId: null,
    };
    const result = markReadyForFinalization(settledAnnual, {
      actorMemberId: command.actor.id,
      atMs: now,
      unresolvedMembersBlock: true,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      state: { ...state, annual: result.state, lastSeq: state.lastSeq + 1 },
      eventType: 'live_command_applied',
      payload: {
        operation: 'ready_for_finalization',
        ...(settledReturnMemberId === null ? {} : { settledReturnMemberId }),
      },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.correct_bid') {
    const executionPhase = state.currentPhase === 'paused' ? live.pausedPhase : state.currentPhase;
    if (
      executionPhase !== 'position_bid' &&
      executionPhase !== 'a_day_bid' &&
      executionPhase !== 'complete'
    )
      return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (!administratorOverride && live.specialty != null)
      return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
    if ((command.operation === 'REVOKE') !== (command.replacement === null))
      return { ok: false, code: 'CORRECTION_OPERATION_INVALID' };
    const active = state.fills[command.originalPositionId];
    const pending = unresolvedBidCorrections(state).find(
      (entry) =>
        entry.bidId === command.originalBidId &&
        entry.commandId === command.originalCommandId &&
        entry.before.positionId === command.originalPositionId,
    );
    const prior = active?.bidId === command.originalBidId ? active : pending?.before.fill;
    if (prior === undefined || (pending !== undefined && command.operation === 'REVOKE'))
      return { ok: false, code: 'CORRECTION_SOURCE_NOT_ACTIVE' };
    if (prior.memberId !== command.memberId)
      return { ok: false, code: 'CORRECTION_MEMBER_MISMATCH' };
    if (
      Object.entries(state.fills).some(
        ([positionId, fill]) =>
          !(positionId === command.originalPositionId && fill.bidId === command.originalBidId) &&
          fill.memberId === command.memberId,
      )
    )
      return { ok: false, code: 'MEMBER_ALREADY_SELECTED' };
    const priorADay =
      state.aDay?.picks.find((pick) => pick.memberId === prior.memberId) ??
      pending?.before.aDay ??
      null;
    const fills = { ...state.fills };
    if (active?.bidId === command.originalBidId) delete fills[command.originalPositionId];
    let after: { positionId: string; fill: Fill } | null = null;
    if (command.replacement !== null) {
      const replacement = command.replacement;
      if (fills[replacement.positionId] !== undefined)
        return { ok: false, code: 'POSITION_FILLED' };
      const reachedStageId = currentLiveBidStage(state, policy)?.id;
      const reachedStage = policy.stages.find((stage) => stage.id === reachedStageId);
      const legalStage = policy.stages.find(
        (stage) =>
          (administratorOverride || stage.memberIds.includes(prior.memberId)) &&
          stage.opportunityPositionIds.includes(replacement.positionId) &&
          (administratorOverride ||
            (reachedStage !== undefined && stage.order <= reachedStage.order)),
      );
      if (!legalStage) return { ok: false, code: 'LIVE_STAGE_NOT_ELIGIBLE' };
      if (
        administratorOverride &&
        (!legalStage.memberIds.includes(prior.memberId) ||
          reachedStage === undefined ||
          legalStage.order > reachedStage.order)
      )
        addAdminBidOverrideWarning(
          overrideWarnings,
          'STAGE_DEVIATION',
          'The replacement departs from the member or stage rights of the frozen selection order.',
        );
      const ordinaryIndex = state.bidOrder.findIndex((entry) => entry.memberId === prior.memberId);
      const owesEarlyADay =
        positionUsesDeferredADay(policy, command.originalPositionId) &&
        prior.aDay === undefined &&
        priorADay === null &&
        ordinaryIndex >= state.queueCursor;
      if (
        !administratorOverride &&
        owesEarlyADay &&
        (replacement.aDay !== null || !positionUsesDeferredADay(policy, replacement.positionId))
      )
        return { ok: false, code: 'CORRECTION_ORDINARY_A_DAY_NOT_REACHED' };
      if (
        !administratorOverride &&
        (prior.aDay !== undefined || priorADay !== null) &&
        replacement.aDay === null
      )
        return { ok: false, code: 'CORRECTION_A_DAY_REQUIRED' };
      if (administratorOverride && replacement.aDay === null)
        addAdminBidOverrideWarning(
          overrideWarnings,
          'A_DAY_DEFERRED',
          'This award retains a pending A-Day choice. The software will prompt at the remaining ordinary turn or after seat selections.',
        );
      const {
        aDay: _oldADay,
        aDayOverride: _oldADayOverride,
        aDayDeferral: _oldDeferral,
        ...preserved
      } = prior;
      const fill: Fill = {
        ...preserved,
        bidId,
        ...(replacement.membershipIds === undefined
          ? {}
          : { membershipIds: replacement.membershipIds }),
        ...(replacement.aDay === null ? {} : { aDay: replacement.aDay }),
        ...(administratorOverride && replacement.aDay === null
          ? {
              aDayDeferral: {
                commandId: command.commandId,
                actorMemberId: command.actor.id,
                reason: command.reason,
                positionId: replacement.positionId,
              },
            }
          : {}),
      };
      fills[replacement.positionId] = fill;
      after = { positionId: replacement.positionId, fill };
    }
    const correction = {
      bidId,
      commandId: command.commandId,
      originalBidId: command.originalBidId,
      originalCommandId: command.originalCommandId,
      originalADayCommandId: command.originalADayCommandId,
      before: { positionId: command.originalPositionId, fill: prior, aDay: priorADay },
      after,
      resolvesCorrectionBidId: pending?.bidId ?? null,
      actorMemberId: command.actor.id,
      reason: command.reason,
      sequence: state.lastSeq + 1,
      atMs: now,
    };
    return {
      ok: true,
      state: {
        ...state,
        fills,
        ...(administratorOverride && after !== null
          ? { annual: settleSelectedMember(annual, prior.memberId) }
          : {}),
        aDay:
          state.aDay === null
            ? null
            : {
                ...state.aDay,
                picks: state.aDay.picks.filter((pick) => pick.memberId !== prior.memberId),
              },
        live: {
          ...live,
          ...(administratorOverride && live.specialty != null ? { specialty: null } : {}),
          corrections: [...(live.corrections ?? []), correction],
          lastSelectionBidId:
            after !== null
              ? bidId
              : live.lastSelectionBidId === prior.bidId
                ? null
                : live.lastSelectionBidId,
        },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'correct_bid',
        correctionOperation: command.operation,
        bidId,
        memberId: prior.memberId,
        originalCommandId: command.originalCommandId,
        originalADayCommandId: command.originalADayCommandId,
        supersedesBidId: command.originalBidId,
        replacementBidId: after?.fill.bidId ?? null,
        before: correction.before,
        after,
        resolvesCorrectionBidId: correction.resolvesCorrectionBidId,
        ...(administratorOverride ? { adminOverride: overridePayload() } : {}),
        ...(administratorOverride && live.specialty != null
          ? { interruptedSpecialty: live.specialty }
          : {}),
      },
      supersedesBidId: command.originalBidId,
    };
  }
  if (command.type === 'live.amend_selection') {
    if (live.lastSelectionBidId === null) return { ok: false, code: 'NO_AMENDABLE_SELECTION' };
    if (command.fromPositionId === command.toPositionId)
      return { ok: false, code: 'AMENDMENT_POSITION_UNCHANGED' };
    const prior = state.fills[command.fromPositionId];
    if (!prior || prior.bidId !== live.lastSelectionBidId)
      return { ok: false, code: 'SELECTION_SEALED' };
    if (prior.memberId !== command.memberId)
      return { ok: false, code: 'AMENDMENT_MEMBER_MISMATCH' };
    if (state.fills[command.toPositionId] !== undefined)
      return { ok: false, code: 'POSITION_FILLED' };
    const selectedStage = policy.stages.find((stage) =>
      stage.opportunityPositionIds.includes(command.fromPositionId),
    );
    if (!selectedStage?.opportunityPositionIds.includes(command.toPositionId))
      return { ok: false, code: 'LIVE_STAGE_NOT_ELIGIBLE' };
    const { aDayOverride: _oldADayOverride, ...preserved } = prior;
    const fill: Fill = {
      ...preserved,
      bidId,
      ...(command.membershipIds === undefined ? {} : { membershipIds: command.membershipIds }),
      ...(command.aDay === undefined ? {} : { aDay: command.aDay }),
    };
    const fills = { ...state.fills };
    delete fills[command.fromPositionId];
    fills[command.toPositionId] = fill;
    return {
      ok: true,
      state: {
        ...state,
        fills,
        live: { ...live, lastSelectionBidId: bidId },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'amend_selection',
        memberId: command.memberId,
        fromPositionId: command.fromPositionId,
        toPositionId: command.toPositionId,
        supersedesBidId: prior.bidId,
        replacementBidId: bidId,
      },
      supersedesBidId: prior.bidId,
    };
  }
  if (command.type === 'live.disposition' && administratorOverride) {
    if (command.disposition !== 'DEFER' && command.disposition !== 'SKIP')
      return { ok: false, code: 'ADMIN_OVERRIDE_DEFER_REQUIRED' };
    const memberId = command.memberId ?? annual.returningMemberId ?? state.currentBidderId;
    if (memberId === null || !policy.stages.some((stage) => stage.memberIds.includes(memberId)))
      return { ok: false, code: 'MEMBER_NOT_IN_FROZEN_ORDER' };
    if (
      command.deferStageId !== undefined &&
      (command.disposition !== 'DEFER' || command.deferStageId !== currentStageId)
    )
      return { ok: false, code: 'ADMIN_OVERRIDE_STAGE_MISMATCH' };
    const committed = state.bidOrder.slice(0, state.queueCursor);
    const remaining = state.bidOrder.slice(state.queueCursor);
    const matches = (entry: BidSessionState['bidOrder'][number]) =>
      command.deferStageId === undefined
        ? entry.memberId === memberId
        : entry.stageId === command.deferStageId;
    let deferred = remaining.filter(matches);
    if (deferred.length === 0 && command.deferStageId === undefined) {
      const source = state.bidOrder.find((entry) => entry.memberId === memberId);
      if (source) deferred = [source];
    }
    if (deferred.length === 0) return { ok: false, code: 'NO_PENDING_STAGE_MEMBERS' };
    const deferredMemberIds = [...new Set(deferred.map((entry) => entry.memberId))].filter(
      (id) =>
        !hasAward(state, id) ||
        (memberHasDeferredOrdinaryTurn(state, policy, id) &&
          !state.aDay?.picks.some((pick) => pick.memberId === id)),
    );
    if (deferredMemberIds.length === 0) return { ok: false, code: 'MEMBER_ALREADY_SELECTED' };
    const bidOrder = [...committed, ...remaining.filter((entry) => !matches(entry)), ...deferred];
    const reordered = { ...state, bidOrder };
    const advance = nextAvailableFrom(reordered, policy, state.queueCursor, now);
    const nextAnnual = {
      ...settleReturnedMember(annual, memberId),
      unresolvedMemberIds: [...new Set([...annual.unresolvedMemberIds, ...deferredMemberIds])],
    };
    addAdminBidOverrideWarning(
      overrideWarnings,
      command.deferStageId === undefined ? 'DEFER_MEMBER' : 'DEFER_STAGE',
      command.deferStageId === undefined
        ? 'This member is postponed to the remaining queue and retains selection rights.'
        : 'All remaining entries in this phase move behind the other pending phases; selection rights are retained.',
    );
    if (memberId !== state.currentBidderId)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'ORDER_DEVIATION',
        'The selected member is outside the current ordinary turn.',
      );
    return {
      ok: true,
      state: {
        ...state,
        ...advance,
        ...(state.currentPhase === 'paused' ? { currentPhase: 'paused' as const } : {}),
        bidOrder,
        annual: nextAnnual,
        live: {
          ...live,
          ...(live.specialty != null ? { specialty: null } : {}),
          currentStageId: bidOrder[advance.queueCursor]?.stageId ?? currentStageId,
          ...(state.currentPhase === 'paused' ? { pausedPhase: advance.currentPhase } : {}),
          dispositions: [
            ...live.dispositions,
            ...deferredMemberIds.map((id) => ({
              memberId: id,
              disposition: 'DEFER',
              stageId: currentStageId,
              reason: command.reason,
              evidenceReference: command.evidenceReference,
            })),
          ],
        },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'disposition',
        disposition: 'DEFER',
        requestedDisposition: command.disposition,
        memberId,
        stageId: currentStageId,
        deferredStageId: command.deferStageId ?? null,
        deferredMemberIds,
        beforeMemberIds: remaining.map((entry) => entry.memberId),
        afterMemberIds: bidOrder.slice(state.queueCursor).map((entry) => entry.memberId),
        retainsLaterSelectionRights: true,
        terminal: false,
        adminOverride: overridePayload(),
        ...(live.specialty != null ? { interruptedSpecialty: live.specialty } : {}),
      },
      supersedesBidId: null,
    };
  }
  if (
    command.type === 'live.disposition' &&
    (command.memberId !== undefined || command.deferStageId !== undefined)
  )
    return { ok: false, code: 'ADMIN_OVERRIDE_REQUIRED' };
  const returningMemberCommand =
    annual.returningMemberId !== null &&
    (state.currentPhase === 'a_day_bid' || state.currentPhase === 'complete') &&
    (command.type === 'live.disposition' ||
      (command.type === 'live.record_selection' && command.memberId === annual.returningMemberId));
  // Queue exhaustion is separate from the sealed annual result. Only the
  // canonical fallback authority can authorize an award in this interval.
  const exhaustedQueueFallback =
    state.currentPhase === 'complete' &&
    fallbackAuthorized &&
    (command.type === 'live.record_selection' || command.type === 'live.force_selection');
  if (
    state.currentPhase !== 'position_bid' &&
    !(command.type === 'live.disposition' && isOrdinaryADayTurn(state, policy)) &&
    !returningMemberCommand &&
    !exhaustedQueueFallback &&
    !administratorOverride
  )
    return { ok: false, code: 'SESSION_NOT_ACTIVE' };
  if (!administratorOverride && live.specialty !== null && live.specialty !== undefined)
    return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
  if (command.type === 'live.disposition') {
    const rule = policy.dispositions.find(
      (candidate) => candidate.disposition === command.disposition,
    );
    if (!rule) return { ok: false, code: 'LIVE_DISPOSITION_POLICY_INCOMPLETE' };
    if (rule.requiresEvidence && command.evidenceReference === null)
      return { ok: false, code: 'DISPOSITION_EVIDENCE_REQUIRED' };
    const dispositionMemberId = annual.returningMemberId ?? state.currentBidderId;
    if (dispositionMemberId === null) return { ok: false, code: 'NO_CURRENT_BIDDER' };
    let dispositionAnnual = annual;
    if (command.disposition === 'UNREACHABLE') {
      const contact = declareUnreachable(annual, annualPolicy, {
        memberId: dispositionMemberId,
        actorMemberId: command.actor.id,
        nowMs: now,
      });
      if (!contact.ok) return contact;
      dispositionAnnual = contact.state;
    }
    const returningMemberDisposition = annual.returningMemberId !== null;
    const advance = rule.advances && !returningMemberDisposition ? next(state, policy, now) : {};
    if (rule.advances && returningMemberDisposition)
      dispositionAnnual = settleReturnedMember(dispositionAnnual, dispositionMemberId);
    return {
      ok: true,
      state: {
        ...state,
        ...advance,
        ...(command.disposition === 'UNREACHABLE' || returningMemberDisposition
          ? { annual: dispositionAnnual }
          : {}),
        live: {
          ...live,
          dispositions: [
            ...live.dispositions,
            {
              memberId: dispositionMemberId,
              disposition: command.disposition,
              stageId: currentStageId,
              reason: command.reason,
              evidenceReference: command.evidenceReference,
            },
          ],
        },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'disposition',
        disposition: command.disposition,
        memberId: dispositionMemberId,
        stageId: currentStageId,
        returns: rule.returns,
        returnStageId: rule.returnStageId,
        retainsLaterSelectionRights: rule.retainsLaterSelectionRights,
        terminal: rule.terminal,
      },
      supersedesBidId: null,
    };
  }
  const memberId = command.type === 'live.force_selection' ? command.memberId : command.memberId;
  const positionId = command.positionId;
  const isReturnedAtCurrentSequence =
    command.type === 'live.record_selection' && annual.returningMemberId === memberId;
  if (
    command.type === 'live.record_selection' &&
    memberId !== state.currentBidderId &&
    !isReturnedAtCurrentSequence &&
    !fallbackAuthorized &&
    !administratorOverride
  )
    return { ok: false, code: 'NOT_CURRENT_BIDDER' };
  if (state.fills[positionId]) return { ok: false, code: 'POSITION_FILLED' };
  if (Object.values(state.fills).some((fill) => fill.memberId === memberId))
    return { ok: false, code: 'MEMBER_ALREADY_SELECTED' };
  // A returned member keeps the rights of the stages already reached, never later ones.
  const stage = administratorOverride
    ? policy.stages.find((candidate) => candidate.opportunityPositionIds.includes(positionId))
    : isReturnedAtCurrentSequence
      ? liveBidSelectionStages(state, policy).find((candidate) =>
          candidate.opportunityPositionIds.includes(positionId),
        )
      : policy.stages.find((candidate) => candidate.id === currentStageId);
  if (!stage)
    return {
      ok: false,
      code: isReturnedAtCurrentSequence
        ? 'LIVE_STAGE_NOT_ELIGIBLE'
        : 'LIVE_STAGE_POLICY_INCOMPLETE',
    };
  if (
    !fallbackAuthorized &&
    !administratorOverride &&
    (!stage.memberIds.includes(memberId) || !stage.opportunityPositionIds.includes(positionId))
  )
    return { ok: false, code: 'LIVE_STAGE_NOT_ELIGIBLE' };
  if ('fallback' in command && command.fallback && !fallbackAuthorized)
    return { ok: false, code: 'FALLBACK_REVIEW_REQUIRED' };
  if (administratorOverride) {
    if (!policy.stages.some((candidate) => candidate.memberIds.includes(memberId)))
      return { ok: false, code: 'MEMBER_NOT_IN_FROZEN_ORDER' };
    if (memberId !== state.currentBidderId && !isReturnedAtCurrentSequence)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'ORDER_DEVIATION',
        'This award is outside the current member turn; other pending members retain their turns.',
      );
    if (stage.id !== currentStageId || !stage.memberIds.includes(memberId))
      addAdminBidOverrideWarning(
        overrideWarnings,
        'STAGE_DEVIATION',
        'This award departs from the current phase or member rights of the frozen selection order.',
      );
    if (live.specialty != null)
      addAdminBidOverrideWarning(
        overrideWarnings,
        'SPECIALTY_INTERRUPTION',
        'This action closes the active specialty interruption; its candidate evidence and pending ordinary turns remain recorded.',
      );
    if (
      positionUsesDeferredADay(policy, positionId) &&
      command.aDay !== undefined &&
      memberId !== state.currentBidderId
    )
      addAdminBidOverrideWarning(
        overrideWarnings,
        'A_DAY_TIMING_DEVIATION',
        'The A-Day is recorded with this early award instead of waiting for the ordinary turn.',
      );
  }
  if (!administratorOverride && positionUsesDeferredADay(policy, positionId)) {
    const ownTurn = memberId === state.currentBidderId || isReturnedAtCurrentSequence;
    if (ownTurn && command.aDay === undefined)
      return { ok: false, code: 'A_DAY_REQUIRED_WITH_SELECTION' };
    if (!ownTurn && command.aDay !== undefined)
      return { ok: false, code: 'A_DAY_DEFERRED_SELECTION_REQUIRED' };
  }
  const entry =
    state.bidOrder.find(
      (candidate) => candidate.memberId === memberId && candidate.stageId === stage.id,
    ) ?? state.bidOrder.find((candidate) => candidate.memberId === memberId);
  if (!entry) return { ok: false, code: 'MEMBER_NOT_IN_FROZEN_ORDER' };
  const nextFills = {
    ...state.fills,
    [positionId]: {
      memberId,
      ordinal: entry.ordinal,
      bidId,
      ...(command.type === 'live.record_selection' && command.membershipIds !== undefined
        ? { membershipIds: command.membershipIds }
        : {}),
      ...(command.aDay === undefined ? {} : { aDay: command.aDay }),
      ...(administratorOverride &&
      command.aDay === undefined &&
      policy.annualOperations?.aDay.execution
        ? {
            aDayDeferral: {
              commandId: command.commandId,
              actorMemberId: command.actor.id,
              reason: command.reason,
              positionId,
            },
          }
        : {}),
    },
  };
  if (
    administratorOverride &&
    command.aDay === undefined &&
    policy.annualOperations?.aDay.execution
  )
    addAdminBidOverrideWarning(
      overrideWarnings,
      'A_DAY_DEFERRED',
      'This award retains a pending A-Day choice. The software will prompt at the remaining ordinary turn or after seat selections.',
    );
  const advance =
    memberId === state.currentBidderId ? next({ ...state, fills: nextFills }, policy, now) : null;
  return {
    ok: true,
    state: {
      ...state,
      ...advance,
      fills: nextFills,
      ...(administratorOverride && state.currentPhase === 'paused'
        ? { currentPhase: 'paused' as const }
        : {}),
      live: {
        ...live,
        lastSelectionBidId: bidId,
        ...(administratorOverride && live.specialty != null ? { specialty: null } : {}),
        ...(administratorOverride && state.currentPhase === 'paused' && advance !== null
          ? { pausedPhase: advance.currentPhase }
          : {}),
      },
      annual: settleSelectedMember(annual, memberId),
      lastSeq: state.lastSeq + 1,
    },
    eventType: 'live_command_applied',
    payload: {
      operation: command.type === 'live.force_selection' ? 'force_selection' : 'record_selection',
      bidId,
      memberId,
      positionId,
      stageId: stage.id,
      ...(administratorOverride
        ? {
            adminOverride: overridePayload(),
            ...(live.specialty != null ? { interruptedSpecialty: live.specialty } : {}),
          }
        : {}),
      ...(command.type === 'live.record_selection' && command.preferenceSheetId
        ? { preferenceSheetId: command.preferenceSheetId }
        : {}),
    },
    supersedesBidId: null,
  };
}
