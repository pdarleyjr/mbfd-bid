import type { FrozenLiveBidPolicy } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';

/** Queue progress remains authoritative after exhaustion; persisted live
 * metadata can still name the stage where the ordinary queue began. */
export function currentLiveBidStage(state: BidSessionState, policy: FrozenLiveBidPolicy) {
  const stageId =
    state.bidOrder[state.queueCursor]?.stageId ??
    state.bidOrder[Math.min(state.queueCursor, state.bidOrder.length) - 1]?.stageId ??
    state.live?.currentStageId;
  return policy.stages.find((stage) => stage.id === stageId);
}

/** Returned members retain every applicable stage already reached. The
 * console and canonical command boundary must offer the same opportunities. */
export function liveBidSelectionStages(state: BidSessionState, policy: FrozenLiveBidPolicy) {
  const current = currentLiveBidStage(state, policy);
  if (!current) return [];
  const returningMemberId = state.annual?.returningMemberId;
  return returningMemberId == null
    ? [current]
    : policy.stages.filter(
        (stage) => stage.memberIds.includes(returningMemberId) && stage.order <= current.order,
      );
}
