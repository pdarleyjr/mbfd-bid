import type { FrozenLiveBidPolicy, LiveBidAction, LiveBidCommand } from '@mbfd/shared';
import type { BidSessionState, Fill, LiveBidProgress } from '../durable/bid-session-state.js';

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
      return 'pause_resume';
    case 'live.transition_stage':
      return 'approve_transition';
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
  if (command.type === 'live.amend_selection') {
    if (live.lastSelectionBidId === null) return { ok: false, code: 'NO_AMENDABLE_SELECTION' };
    const prior = state.fills[command.positionId];
    if (!prior || prior.bidId !== live.lastSelectionBidId)
      return { ok: false, code: 'SELECTION_SEALED' };
    const fill: Fill = { ...prior, memberId: command.replacementMemberId, bidId };
    return {
      ok: true,
      state: {
        ...state,
        fills: { ...state.fills, [command.positionId]: fill },
        live: { ...live, lastSelectionBidId: bidId },
        lastSeq: state.lastSeq + 1,
      },
      eventType: 'live_command_applied',
      payload: {
        operation: 'amend_selection',
        positionId: command.positionId,
        replacementMemberId: command.replacementMemberId,
        supersedesBidId: prior.bidId,
      },
      supersedesBidId: prior.bidId,
    };
  }
  if (state.currentPhase !== 'position_bid') return { ok: false, code: 'SESSION_NOT_ACTIVE' };
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
  if (command.type === 'live.record_selection' && memberId !== state.currentBidderId)
    return { ok: false, code: 'NOT_CURRENT_BIDDER' };
  if (state.fills[positionId]) return { ok: false, code: 'POSITION_FILLED' };
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
      lastSeq: state.lastSeq + 1,
    },
    eventType: 'live_command_applied',
    payload: {
      operation: command.type === 'live.force_selection' ? 'force_selection' : 'record_selection',
      bidId,
      memberId,
      positionId,
      stageId: currentStageId,
    },
    supersedesBidId: null,
  };
}
