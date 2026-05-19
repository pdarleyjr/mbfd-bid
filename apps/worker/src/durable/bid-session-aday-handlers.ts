// apps/worker/src/durable/bid-session-aday-handlers.ts
//
// Phase 2 (A-Day) handlers for the BidSessionDO. Pure transitions over
// BidSessionState — same shape and conventions as bid-session-handlers.ts
// (Phase 1 handlers).

import {
  type ADayPick,
  type ADayState,
  type ADayValue,
  DEFAULT_GROUP_CAPACITY,
  type GroupCapacityConfig,
  type Member,
  type Phase2BidOrderStrategy,
  type PickRejectionCode,
  type PickValidation,
  type Shift,
  type WeekdayCapacityConfig,
  applyPick,
  canPick,
  initADayState,
  nextBidder,
  phase2BidOrder,
} from '@mbfd/a-day';
import type { BidSessionState, PersistedADayState } from './bid-session-state.js';

/** Rebuild the in-memory ADayState from the persisted snapshot + member roster. */
export function hydrateADayState(
  persisted: PersistedADayState,
  membersById: ReadonlyMap<number, Member>,
): ADayState {
  return {
    groupCaps: persisted.groupCaps,
    weekdayCaps: persisted.weekdayCaps,
    picksByMember: new Map(persisted.picks.map((p) => [p.memberId, p])),
    bidOrder: persisted.bidOrder,
    cursor: persisted.cursor,
    phase1ByMember: new Map(persisted.phase1),
    membersById,
  };
}

/** Convert an in-memory ADayState back to the JSON-safe persisted shape. */
export function dehydrateADayState(state: ADayState): PersistedADayState {
  return {
    groupCaps: state.groupCaps,
    weekdayCaps: state.weekdayCaps,
    picks: [...state.picksByMember.values()],
    bidOrder: [...state.bidOrder],
    cursor: state.cursor,
    phase1: [...state.phase1ByMember.entries()],
  };
}

export interface TransitionToPhase2Input {
  /** Members in the session roster. */
  members: readonly Member[];
  /**
   * Phase-1 ordering as a list of member ids (e.g., from bid_order.ordinal asc).
   * Used as the input to the bid-order generator.
   */
  phase1Order: readonly number[];
  /** Phase-1 picks: one entry per non-vacant filled position. */
  phase1Picks: ReadonlyArray<{ memberId: number; positionId: string; shift: Shift }>;
  /** Strategy (default 'phase_1_order'). */
  strategy?: Phase2BidOrderStrategy;
  /** Optional group capacities override (per-shift, per-group). */
  groupCaps?: Readonly<
    Record<'A' | 'B' | 'C', Readonly<Record<'G1' | 'G2' | 'G3' | 'G4', GroupCapacityConfig>>>
  >;
  /** Optional weekday caps (D-shift); missing keys mean no cap. */
  weekdayCaps?: Readonly<
    Partial<Record<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN', WeekdayCapacityConfig>>
  >;
  /** Optional pre-seeded picks (Union President etc.). */
  preSeededPicks?: readonly ADayPick[];
}

/**
 * Pure transition: returns a new BidSessionState moved into Phase 2.
 * Caller is responsible for persisting and broadcasting `phase_changed`.
 */
export function transitionToPhase2(
  state: BidSessionState,
  input: TransitionToPhase2Input,
  nowMs: number,
): BidSessionState {
  const strategy = input.strategy ?? 'phase_1_order';
  const defaultCaps = {
    A: {
      G1: DEFAULT_GROUP_CAPACITY,
      G2: DEFAULT_GROUP_CAPACITY,
      G3: DEFAULT_GROUP_CAPACITY,
      G4: DEFAULT_GROUP_CAPACITY,
    },
    B: {
      G1: DEFAULT_GROUP_CAPACITY,
      G2: DEFAULT_GROUP_CAPACITY,
      G3: DEFAULT_GROUP_CAPACITY,
      G4: DEFAULT_GROUP_CAPACITY,
    },
    C: {
      G1: DEFAULT_GROUP_CAPACITY,
      G2: DEFAULT_GROUP_CAPACITY,
      G3: DEFAULT_GROUP_CAPACITY,
      G4: DEFAULT_GROUP_CAPACITY,
    },
  } as const;
  const groupCaps = input.groupCaps ?? defaultCaps;
  const weekdayCaps = input.weekdayCaps ?? {};
  const preSeededIds = (input.preSeededPicks ?? []).map((p) => p.memberId);

  const order = phase2BidOrder({
    strategy,
    phase1Order: input.phase1Order,
    phase1Picks: input.phase1Picks,
    members: input.members,
    preSeededMemberIds: preSeededIds,
  });

  const aDayInMemory = initADayState({
    phase1Picks: input.phase1Picks,
    members: input.members,
    bidOrder: order,
    ...(input.preSeededPicks !== undefined ? { preSeededPicks: input.preSeededPicks } : {}),
    groupCaps,
    weekdayCaps,
  });

  const nextId = nextBidder(aDayInMemory) ?? null;
  return {
    ...state,
    currentPhase: nextId === null ? 'complete' : 'a_day_bid',
    currentBidderId: nextId,
    turnStartedAtMs: nextId === null ? 0 : nowMs,
    lastSeq: state.lastSeq + 1,
    aDay: dehydrateADayState(aDayInMemory),
  };
}

export interface SubmitADayPickInput {
  senderMemberId: number;
  aDay: ADayValue;
  idempotencyKey: string;
  /** Server roster lookup (the DO's in-memory member map). */
  members: readonly Member[];
  /** For forced picks; null otherwise. */
  forced?: boolean;
  adminActorId?: number | null;
  reason?: string | null;
}

export interface AcceptedADayPick {
  kind: 'accepted';
  newState: BidSessionState;
  pick: ADayPick;
  nextMemberId: number | null;
  validation: Extract<PickValidation, { ok: true }>;
}

export interface RejectedADayPick {
  kind: 'rejected';
  code: PickRejectionCode | 'NOT_YOUR_TURN' | 'PHASE_NOT_A_DAY_BID' | 'SESSION_FROZEN';
  message: string;
  idempotencyKey: string;
  detail?: Readonly<Record<string, string | number | boolean>>;
}

export type SubmitADayPickResult = AcceptedADayPick | RejectedADayPick;

/**
 * Pure handler for a Phase-2 A-Day pick. Caller passes the current session
 * state, the in-memory member roster (used to populate the ephemeral
 * membersById map for invariant checks), and the pick request.
 *
 * Returns either:
 *  - accepted: new state + the pick to persist
 *  - rejected: structured reject code + message
 */
export function handleSubmitADayPick(
  state: BidSessionState,
  input: SubmitADayPickInput,
  nowMs: number,
): SubmitADayPickResult {
  if (state.frozenAt !== null) {
    return {
      kind: 'rejected',
      code: 'SESSION_FROZEN',
      message: 'Bid session is frozen; only admin overrides may mutate state.',
      idempotencyKey: input.idempotencyKey,
    };
  }
  if (state.currentPhase !== 'a_day_bid' || state.aDay === null) {
    return {
      kind: 'rejected',
      code: 'PHASE_NOT_A_DAY_BID',
      message: `Cannot submit A-Day pick: session phase is ${state.currentPhase}.`,
      idempotencyKey: input.idempotencyKey,
    };
  }
  // Forced picks bypass the "not your turn" check.
  if (!input.forced && state.currentBidderId !== input.senderMemberId) {
    return {
      kind: 'rejected',
      code: 'NOT_YOUR_TURN',
      message: `It is not member ${input.senderMemberId}'s turn to pick.`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  const membersById = new Map(input.members.map((mem) => [Number(mem.employeeId), mem]));
  const aDayState = hydrateADayState(state.aDay, membersById);

  // For forced picks we skip canPick (admin override path bypasses invariants).
  if (!input.forced) {
    const validation = canPick(aDayState, input.senderMemberId, input.aDay);
    if (!validation.ok) {
      return {
        kind: 'rejected',
        code: validation.reasonCode,
        message: validation.reasonLabel,
        idempotencyKey: input.idempotencyKey,
        ...(validation.detail !== undefined ? { detail: validation.detail } : {}),
      };
    }
    const phase1 = aDayState.phase1ByMember.get(input.senderMemberId);
    if (!phase1) {
      return {
        kind: 'rejected',
        code: 'NO_PHASE_1_PICK',
        message: `Member ${input.senderMemberId} has no Phase 1 pick.`,
        idempotencyKey: input.idempotencyKey,
      };
    }
    const pick: ADayPick = {
      memberId: input.senderMemberId,
      shift: phase1.shift,
      aDay: input.aDay,
      pickedAtMs: nowMs,
      forced: false,
      adminActorId: null,
    };
    const nextAday = applyPick(aDayState, pick);
    const nextMemberId = nextBidder(nextAday) ?? null;
    const isPhase2Done = nextMemberId === null;
    return {
      kind: 'accepted',
      newState: {
        ...state,
        currentPhase: isPhase2Done ? 'complete' : 'a_day_bid',
        currentBidderId: nextMemberId,
        turnStartedAtMs: isPhase2Done ? 0 : nowMs,
        lastSeq: state.lastSeq + 1,
        aDay: dehydrateADayState(nextAday),
      },
      pick,
      nextMemberId,
      validation,
    };
  }

  // Forced pick path — no canPick gate, but we still need a shift from phase1
  // or fall back to whatever the admin supplied via input (require phase1 here
  // because the table needs the shift).
  const phase1 = aDayState.phase1ByMember.get(input.senderMemberId);
  if (!phase1) {
    return {
      kind: 'rejected',
      code: 'NO_PHASE_1_PICK',
      message: `Member ${input.senderMemberId} has no Phase 1 pick.`,
      idempotencyKey: input.idempotencyKey,
    };
  }
  const pick: ADayPick = {
    memberId: input.senderMemberId,
    shift: phase1.shift,
    aDay: input.aDay,
    pickedAtMs: nowMs,
    forced: true,
    adminActorId: input.adminActorId ?? null,
  };
  const nextAday = applyPick(aDayState, pick);
  const nextMemberId = nextBidder(nextAday) ?? null;
  const isPhase2Done = nextMemberId === null;
  // Synthesize a validation-shaped object so callers can reuse the meter UI.
  const projectedMeter = {
    total: 0,
    max: undefined,
    officers: 0,
    officersRequired: undefined,
    isFull: false,
  };
  return {
    kind: 'accepted',
    newState: {
      ...state,
      currentPhase: isPhase2Done ? 'complete' : 'a_day_bid',
      currentBidderId: nextMemberId,
      turnStartedAtMs: isPhase2Done ? 0 : nowMs,
      lastSeq: state.lastSeq + 1,
      aDay: dehydrateADayState(nextAday),
    },
    pick,
    nextMemberId,
    validation: { ok: true, projectedMeter },
  };
}
