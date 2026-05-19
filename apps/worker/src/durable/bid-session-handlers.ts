import type { EligibilityResult } from '@mbfd/eligibility';
import type {
  ForcedPickEvent,
  FreezeEvent,
  PickMadeEvent,
  PickRejectCode,
  SkipEvent,
} from '@mbfd/shared';
import type { BidSessionState } from './bid-session-state.js';

export interface HandlerEnv {
  nowMs: () => number;
  newBidId: () => string;
  evaluateEligibility: (input: { memberId: number; positionId: string }) => EligibilityResult;
}

interface AcceptedSubmitPick {
  kind: 'accepted';
  newState: BidSessionState;
  event: { type: 'pick_made'; payload: PickMadeEvent };
}
interface RejectedResult {
  kind: 'rejected';
  code: PickRejectCode;
  message: string;
  idempotencyKey?: string;
}
interface AcceptedSkip {
  kind: 'accepted';
  newState: BidSessionState;
  event: { type: 'skip'; payload: SkipEvent };
}
interface AcceptedForce {
  kind: 'accepted';
  newState: BidSessionState;
  event: { type: 'forced_pick'; payload: ForcedPickEvent };
}
interface AcceptedFreeze {
  kind: 'accepted';
  newState: BidSessionState;
  event: { type: 'freeze'; payload: FreezeEvent };
}

export interface SubmitPickInput {
  senderMemberId: number;
  positionId: string;
  rDay: string | null;
  idempotencyKey: string;
}
export interface SkipInput {
  adminActorId: number;
  reason: string;
}
export interface ForcePickInput {
  adminActorId: number;
  targetMemberId: number;
  positionId: string;
  reason: string;
}
export interface FreezeInput {
  adminActorId: number;
  reason: string;
}

function rejectFrozen(state: BidSessionState, key?: string): RejectedResult | null {
  if (state.frozenAt !== null) {
    return {
      kind: 'rejected',
      code: 'SESSION_FROZEN',
      message: 'Bid session is frozen; only admin overrides may mutate state.',
      ...(key !== undefined && { idempotencyKey: key }),
    };
  }
  return null;
}

interface AdvanceResult {
  nextBidderId: number | null;
  nextPhase: BidSessionState['currentPhase'];
  nextCursor: number;
}

function advance(state: BidSessionState): AdvanceResult {
  const nextCursor = state.queueCursor + 1;
  const next = state.bidOrder[nextCursor];
  if (next === undefined) {
    return { nextBidderId: null, nextPhase: 'complete', nextCursor };
  }
  return { nextBidderId: next.memberId, nextPhase: state.currentPhase, nextCursor };
}

function currentOrdinal(state: BidSessionState): number {
  const entry = state.bidOrder[state.queueCursor];
  if (entry === undefined) {
    throw new Error(`queueCursor ${state.queueCursor} out of range`);
  }
  return entry.ordinal;
}

export function handleSubmitPick(
  state: BidSessionState,
  env: HandlerEnv,
  input: SubmitPickInput,
): AcceptedSubmitPick | RejectedResult {
  const frozen = rejectFrozen(state, input.idempotencyKey);
  if (frozen) {
    return frozen;
  }

  if (state.currentPhase === 'paused') {
    return {
      kind: 'rejected',
      code: 'SESSION_PAUSED',
      message: 'Bid session is paused.',
      idempotencyKey: input.idempotencyKey,
    };
  }

  if (state.currentBidderId !== input.senderMemberId) {
    return {
      kind: 'rejected',
      code: 'NOT_YOUR_TURN',
      message: `Active bidder is member ${state.currentBidderId ?? 'none'}; sender is ${input.senderMemberId}.`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  if (state.fills[input.positionId]) {
    return {
      kind: 'rejected',
      code: 'POSITION_FILLED',
      message: `Position ${input.positionId} is already filled.`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  const elig = env.evaluateEligibility({
    memberId: input.senderMemberId,
    positionId: input.positionId,
  });
  if (!elig.eligible) {
    return {
      kind: 'rejected',
      code: 'NOT_ELIGIBLE',
      message: `Not eligible: ${elig.reasons
        .filter((r) => !r.satisfied)
        .map((r) => r.label)
        .join('; ')}`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  const ordinal = currentOrdinal(state);
  const bidId = env.newBidId();
  const { nextBidderId, nextPhase, nextCursor } = advance(state);
  const turnStartedAtMs = nextBidderId === null ? 0 : env.nowMs();

  const newState: BidSessionState = {
    ...state,
    fills: {
      ...state.fills,
      [input.positionId]: { memberId: input.senderMemberId, ordinal, bidId },
    },
    currentBidderId: nextBidderId,
    currentPhase: nextPhase,
    queueCursor: nextCursor,
    turnStartedAtMs,
    lastSeq: state.lastSeq + 1,
  };

  const payload: PickMadeEvent = {
    bidId,
    bidSessionId: state.bidSessionId,
    ordinal,
    memberId: input.senderMemberId,
    positionId: input.positionId,
    rDay: input.rDay,
    idempotencyKey: input.idempotencyKey,
    nextBidderId,
    turnStartedAtMs,
  };

  return { kind: 'accepted', newState, event: { type: 'pick_made', payload } };
}

export function handleSkip(
  state: BidSessionState,
  env: HandlerEnv,
  input: SkipInput,
): AcceptedSkip | RejectedResult {
  const frozen = rejectFrozen(state);
  if (frozen) {
    return frozen;
  }
  if (state.currentBidderId === null) {
    return { kind: 'rejected', code: 'PROTOCOL_ERROR', message: 'No active bidder to skip.' };
  }
  const skippedMemberId = state.currentBidderId;
  const ordinal = currentOrdinal(state);
  const { nextBidderId, nextPhase, nextCursor } = advance(state);
  const turnStartedAtMs = nextBidderId === null ? 0 : env.nowMs();
  const newState: BidSessionState = {
    ...state,
    currentBidderId: nextBidderId,
    currentPhase: nextPhase,
    queueCursor: nextCursor,
    turnStartedAtMs,
    lastSeq: state.lastSeq + 1,
  };
  return {
    kind: 'accepted',
    newState,
    event: {
      type: 'skip',
      payload: {
        bidSessionId: state.bidSessionId,
        skippedMemberId,
        ordinal,
        reason: input.reason,
        nextBidderId,
        turnStartedAtMs,
      },
    },
  };
}

export function handleForcePick(
  state: BidSessionState,
  env: HandlerEnv,
  input: ForcePickInput,
): AcceptedForce | RejectedResult {
  const frozen = rejectFrozen(state);
  if (frozen) {
    return frozen;
  }
  if (state.fills[input.positionId]) {
    return {
      kind: 'rejected',
      code: 'POSITION_FILLED',
      message: `Position ${input.positionId} is already filled.`,
    };
  }
  const queueIndex = state.bidOrder.findIndex((o) => o.memberId === input.targetMemberId);
  if (queueIndex === -1) {
    return {
      kind: 'rejected',
      code: 'PROTOCOL_ERROR',
      message: `Member ${input.targetMemberId} not found in bid order.`,
    };
  }
  const orderEntry = state.bidOrder[queueIndex];
  if (orderEntry === undefined) {
    return {
      kind: 'rejected',
      code: 'PROTOCOL_ERROR',
      message: 'Internal: bid order entry missing.',
    };
  }
  const ordinal = orderEntry.ordinal;
  const bidId = env.newBidId();

  let newState: BidSessionState;
  if (queueIndex === state.queueCursor) {
    const { nextBidderId, nextPhase, nextCursor } = advance(state);
    const turnStartedAtMs = nextBidderId === null ? 0 : env.nowMs();
    newState = {
      ...state,
      fills: {
        ...state.fills,
        [input.positionId]: { memberId: input.targetMemberId, ordinal, bidId },
      },
      currentBidderId: nextBidderId,
      currentPhase: nextPhase,
      queueCursor: nextCursor,
      turnStartedAtMs,
      lastSeq: state.lastSeq + 1,
    };
  } else {
    newState = {
      ...state,
      fills: {
        ...state.fills,
        [input.positionId]: { memberId: input.targetMemberId, ordinal, bidId },
      },
      lastSeq: state.lastSeq + 1,
    };
  }

  return {
    kind: 'accepted',
    newState,
    event: {
      type: 'forced_pick',
      payload: {
        bidId,
        bidSessionId: state.bidSessionId,
        ordinal,
        memberId: input.targetMemberId,
        positionId: input.positionId,
        adminActorId: input.adminActorId,
        reason: input.reason,
      },
    },
  };
}

export function handleFreeze(
  state: BidSessionState,
  env: HandlerEnv,
  input: FreezeInput,
): AcceptedFreeze | RejectedResult {
  if (state.frozenAt !== null) {
    return {
      kind: 'rejected',
      code: 'SESSION_FROZEN',
      message: 'Session is already frozen.',
    };
  }
  const frozenAt = env.nowMs();
  const newState: BidSessionState = {
    ...state,
    frozenAt,
    currentPhase: 'paused',
    lastSeq: state.lastSeq + 1,
  };
  return {
    kind: 'accepted',
    newState,
    event: {
      type: 'freeze',
      payload: {
        bidSessionId: state.bidSessionId,
        frozenAt,
        freezeActorId: input.adminActorId,
        reason: input.reason,
      },
    },
  };
}
