import type { FrozenLiveBidPolicy, LiveBidAction, LiveBidCommand } from '@mbfd/shared';
import type { BidSessionState, Fill, LiveBidProgress } from '../durable/bid-session-state.js';
import {
  checkpointAnnualOperations,
  declareUnreachable,
  initializeAnnualOperations,
  markReadyForFinalization,
  recordContactAttempt,
  returnAtCurrentSequence,
} from '../lib/annual-bid-operations.js';

export type LiveReduction =
  | {
      ok: true;
      state: BidSessionState;
      eventType: 'live_command_applied';
      payload: Record<string, unknown>;
      supersedesBidId: string | null;
    }
  | { ok: false; code: string };

function actionFor(command: LiveBidCommand): LiveBidAction {
  switch (command.type) {
    case 'live.record_selection':
      return 'record_selection';
    case 'live.amend_selection':
      return 'amend_selection';
    case 'live.disposition':
      return command.disposition === 'UNREACHABLE' ? 'mark_unreachable' : 'skip_defer';
    case 'live.force_selection':
      return 'force';
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
    case 'live.transition_stage':
      return 'approve_transition';
    case 'live.alter_order':
      return 'alter_order';
    case 'live.start_specialty_adjudication':
    case 'live.resolve_specialty_candidate':
      return 'approve_transition';
    case 'live.set_presentation_mode':
      return 'publish';
  }
}

function next(
  state: BidSessionState,
  now: number,
): Pick<BidSessionState, 'queueCursor' | 'currentBidderId' | 'currentPhase' | 'turnStartedAtMs'> {
  const queueCursor = state.queueCursor + 1;
  const entry = state.bidOrder[queueCursor];
  return entry
    ? {
        queueCursor,
        currentBidderId: entry.memberId,
        currentPhase: 'position_bid',
        turnStartedAtMs: now,
      }
    : { queueCursor, currentBidderId: null, currentPhase: 'complete', turnStartedAtMs: 0 };
}
function stageFor(state: BidSessionState): string | null {
  return state.bidOrder[state.queueCursor]?.stageId ?? state.live?.currentStageId ?? null;
}
function progress(state: BidSessionState): LiveBidProgress {
  return (
    state.live ?? {
      currentStageId: stageFor(state),
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
): LiveReduction {
  const permitted = policy.actionPermissions.some(
    (grant) =>
      grant.action === actionFor(command) && grant.actorMemberIds.includes(command.actor.id),
  );
  if (!permitted) return { ok: false, code: 'LIVE_ACTION_FORBIDDEN' };
  if (state.frozenAt !== null) return { ok: false, code: 'SESSION_FROZEN' };
  // `live.complete_session` seals the exact canonical result consumed by
  // Post-Bid. Receipt replay remains handled before reduction; a new command
  // must never mutate awards, A-Day, disposition, or staging afterwards.
  if (state.annual?.completion !== null && state.annual?.completion !== undefined)
    return { ok: false, code: 'ANNUAL_COMPLETION_SEALED' };
  const live = progress(state);
  const currentStageId = stageFor(state);
  if (currentStageId === null || !policy.stages.some((stage) => stage.id === currentStageId))
    return { ok: false, code: 'LIVE_STAGE_POLICY_INCOMPLETE' };
  if (command.type === 'live.pause') {
    if (state.currentPhase === 'paused') return { ok: false, code: 'SESSION_PAUSED' };
    return {
      ok: true,
      state: {
        ...state,
        currentPhase: 'paused',
        live: { ...live, pausedPhase: state.currentPhase },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: { operation: 'pause', stageId: currentStageId },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.resume') {
    if (state.currentPhase !== 'paused' || live.pausedPhase === null)
      return { ok: false, code: 'SESSION_NOT_PAUSED' };
    return {
      ok: true,
      state: {
        ...state,
        currentPhase: live.pausedPhase,
        live: { ...live, pausedPhase: null },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: { operation: 'resume', stageId: currentStageId },
      supersedesBidId: null,
    };
  }
  if (command.type === 'live.transition_stage') {
    const target = policy.stages.find((stage) => stage.id === command.stageId);
    if (
      !target ||
      target.order <=
        (policy.stages.find((stage) => stage.id === currentStageId)?.order ??
          Number.POSITIVE_INFINITY)
    )
      return { ok: false, code: 'INVALID_STAGE_TRANSITION' };
    const index = state.bidOrder.findIndex((entry) => entry.stageId === target.id);
    if (index < 0) return { ok: false, code: 'LIVE_STAGE_POLICY_INCOMPLETE' };
    return {
      ok: true,
      state: {
        ...state,
        queueCursor: index,
        currentBidderId: state.bidOrder[index]?.memberId ?? null,
        turnStartedAtMs: now,
        live: {
          ...live,
          currentStageId: target.id,
          completedStageIds: [...live.completedStageIds, currentStageId],
        },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: { operation: 'transition_stage', fromStageId: currentStageId, stageId: target.id },
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
    if (state.currentPhase !== 'position_bid') return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (live.specialty !== null && live.specialty !== undefined)
      return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
    const committed = state.bidOrder.slice(0, state.queueCursor);
    const remaining = state.bidOrder.slice(state.queueCursor);
    const supplied = command.orderedRemainingMemberIds;
    if (
      supplied.length !== remaining.length ||
      new Set(supplied).size !== supplied.length ||
      remaining.some((entry) => !supplied.includes(entry.memberId))
    ) {
      return { ok: false, code: 'ALTER_ORDER_MEMBER_SET_MISMATCH' };
    }
    const byMember = new Map(remaining.map((entry) => [entry.memberId, entry]));
    const reordered = supplied.map((memberId) => byMember.get(memberId));
    if (reordered.some((entry) => entry === undefined))
      return { ok: false, code: 'ALTER_ORDER_MEMBER_SET_MISMATCH' };
    const stageOrder = new Map(policy.stages.map((stage) => [stage.id, stage.order]));
    let priorStageOrder = Number.NEGATIVE_INFINITY;
    for (const entry of reordered) {
      const order = entry?.stageId === undefined ? undefined : stageOrder.get(entry.stageId ?? '');
      if (order === undefined || order < priorStageOrder)
        return { ok: false, code: 'ALTER_ORDER_STAGE_SEQUENCE_INVALID' };
      priorStageOrder = order;
    }
    const beforeMemberIds = remaining.map((entry) => entry.memberId);
    const bidOrder = [...committed, ...(reordered as typeof remaining)];
    return {
      ok: true,
      state: {
        ...state,
        bidOrder,
        currentBidderId: bidOrder[state.queueCursor]?.memberId ?? null,
        turnStartedAtMs: now,
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'alter_order',
        beforeMemberIds,
        afterMemberIds: supplied,
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
        const minimumAttempts = policy.annualOperations?.contact.minimumAttempts;
        if (minimumAttempts === undefined) return { ok: false, code: 'CONTACT_POLICY_MISSING' };
        const attempts = (state.annual?.contactAttempts ?? []).filter(
          (attempt) => attempt.memberId === command.memberId,
        ).length;
        if (attempts < minimumAttempts) return { ok: false, code: 'CONTACT_ATTEMPTS_INCOMPLETE' };
      }
    }
    if (command.outcome === 'ACCEPT') {
      const existingFills = Object.entries(state.fills).filter(
        ([, candidateFill]) => candidateFill.memberId === command.memberId,
      );
      if (existingFills.length > 1)
        return { ok: false, code: 'SPECIALTY_CANDIDATE_FILL_AMBIGUOUS' };
      const prior = existingFills[0];
      const fill: Fill = {
        memberId: command.memberId,
        ordinal:
          prior?.[1].ordinal ??
          state.bidOrder.find((entry) => entry.memberId === command.memberId)?.ordinal ??
          0,
        bidId,
      };
      const fills = { ...state.fills };
      if (prior !== undefined) delete fills[prior[0]];
      fills[specialty.positionId] = fill;
      const candidateOrderIndex = state.bidOrder.findIndex(
        (entry) => entry.memberId === command.memberId,
      );
      const removeFromRemainingOrder =
        prior === undefined && candidateOrderIndex >= state.queueCursor;
      const bidOrder = removeFromRemainingOrder
        ? state.bidOrder.filter((entry) => entry.memberId !== command.memberId)
        : state.bidOrder;
      return {
        ok: true,
        state: {
          ...state,
          fills,
          bidOrder,
          live: { ...live, specialty: null },
          lastSeq: state.lastSeq + 1,
        },
        eventType: 'live_command_applied',
        payload: {
          operation: 'resolve_specialty_candidate',
          specialtyId: specialty.specialtyId,
          positionId: specialty.positionId,
          memberId: command.memberId,
          outcome: command.outcome,
          resumedBidderId: specialty.suspendedBidderId,
          releasedPositionId: prior?.[0] ?? null,
          supersedesBidId: prior?.[1].bidId ?? null,
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
  const annual = state.annual ?? initializeAnnualOperations({ preferenceSheets: [] });
  const annualPolicy = policy.annualOperations;
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
    const result = declareUnreachable(annual, annualPolicy, {
      memberId: command.memberId,
      actorMemberId: command.actor.id,
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
    const result = returnAtCurrentSequence(annual, {
      memberId: command.memberId,
      sequence: state.lastSeq,
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
    const result = markReadyForFinalization(annual, {
      actorMemberId: command.actor.id,
      atMs: now,
      unresolvedMembersBlock: true,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      state: { ...state, annual: result.state, lastSeq: state.lastSeq + 1 },
      eventType: 'live_command_applied',
      payload: { operation: 'ready_for_finalization' },
      supersedesBidId: null,
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
    const selectedEntry = state.bidOrder.find((entry) => entry.memberId === command.memberId);
    const selectedStage = policy.stages.find((stage) => stage.id === selectedEntry?.stageId);
    if (!selectedStage?.opportunityPositionIds.includes(command.toPositionId))
      return { ok: false, code: 'LIVE_STAGE_NOT_ELIGIBLE' };
    const fill: Fill = { ...prior, bidId };
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
      },
      supersedesBidId: prior.bidId,
    };
  }
  if (state.currentPhase !== 'position_bid') return { ok: false, code: 'SESSION_NOT_ACTIVE' };
  if (live.specialty !== null && live.specialty !== undefined)
    return { ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
  if (command.type === 'live.disposition') {
    const rule = policy.dispositions.find(
      (candidate) => candidate.disposition === command.disposition,
    );
    if (!rule) return { ok: false, code: 'LIVE_DISPOSITION_POLICY_INCOMPLETE' };
    if (
      (rule.requiresEvidence && command.evidenceReference === null) ||
      (rule.requiresReason && !command.reason.trim())
    )
      return { ok: false, code: 'DISPOSITION_EVIDENCE_REQUIRED' };
    if (state.currentBidderId === null) return { ok: false, code: 'NO_CURRENT_BIDDER' };
    const advance = rule.advances ? next(state, now) : {};
    return {
      ok: true,
      state: {
        ...state,
        ...advance,
        live: {
          ...live,
          dispositions: [
            ...live.dispositions,
            {
              memberId: state.currentBidderId,
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
        memberId: state.currentBidderId,
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
    !isReturnedAtCurrentSequence
  )
    return { ok: false, code: 'NOT_CURRENT_BIDDER' };
  if (state.fills[positionId]) return { ok: false, code: 'POSITION_FILLED' };
  if (Object.values(state.fills).some((fill) => fill.memberId === memberId))
    return { ok: false, code: 'MEMBER_ALREADY_SELECTED' };
  const stage = policy.stages.find((candidate) => candidate.id === currentStageId);
  if (!stage) return { ok: false, code: 'LIVE_STAGE_POLICY_INCOMPLETE' };
  if (!stage.memberIds.includes(memberId) || !stage.opportunityPositionIds.includes(positionId))
    return { ok: false, code: 'LIVE_STAGE_NOT_ELIGIBLE' };
  const entry = state.bidOrder.find((candidate) => candidate.memberId === memberId);
  if (!entry) return { ok: false, code: 'MEMBER_NOT_IN_FROZEN_ORDER' };
  const advance = memberId === state.currentBidderId ? next(state, now) : {};
  return {
    ok: true,
    state: {
      ...state,
      ...advance,
      fills: { ...state.fills, [positionId]: { memberId, ordinal: entry.ordinal, bidId } },
      live: { ...live, lastSelectionBidId: bidId },
      annual: isReturnedAtCurrentSequence ? { ...annual, returningMemberId: null } : annual,
      lastSeq: state.lastSeq + 1,
    },
    eventType: 'live_command_applied',
    payload: {
      operation: command.type === 'live.force_selection' ? 'force_selection' : 'record_selection',
      bidId,
      memberId,
      positionId,
      stageId: currentStageId,
      ...(command.type === 'live.record_selection' && command.preferenceSheetId
        ? { preferenceSheetId: command.preferenceSheetId }
        : {}),
    },
    supersedesBidId: null,
  };
}
