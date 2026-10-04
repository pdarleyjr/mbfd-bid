import type { ADayPick, GroupCapacityConfig, WeekdayCapacityConfig } from '@mbfd/a-day';
import type { AnnualOperationsState } from '../lib/annual-bid-operations.js';

export interface DOStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
}

export type CurrentPhase = 'config' | 'position_bid' | 'a_day_bid' | 'paused' | 'complete';

/**
 * Persisted Phase-2 A-Day state, embedded in BidSessionState. Map fields are
 * serialized as arrays so the whole BidSessionState round-trips through JSON.
 */
export interface PersistedADayState {
  constraints?: import('@mbfd/a-day').ADayState['constraints'];
  allocationIncomplete?: boolean;
  /** Group capacities keyed by shift then group. */
  groupCaps: Readonly<
    Record<'A' | 'B' | 'C', Readonly<Record<'G1' | 'G2' | 'G3' | 'G4', GroupCapacityConfig>>>
  >;
  /** D-shift weekday caps; missing keys mean no cap. */
  weekdayCaps: Readonly<
    Partial<Record<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN', WeekdayCapacityConfig>>
  >;
  /** All picks so far (memberId-keyed externally; persisted as array for JSON). */
  picks: readonly ADayPick[];
  /** Phase-2 ordered list of member ids; cursor advances on each pick. */
  bidOrder: readonly number[];
  /** Index into bidOrder of the next member to pick. */
  cursor: number;
  /** Phase 1 picks (memberId → positionId + shift) — flat tuple list. */
  phase1: readonly [number, { positionId: string; shift: 'A' | 'B' | 'C' | 'D' }][];
}

export interface Fill {
  /** Audited decision to defer this award's A-Day without changing source timing. */
  aDayDeferral?: {
    commandId: string;
    actorMemberId: number;
    reason: string;
    positionId: string;
  };
  /** Immutable operator provenance; amendments retain this marker. */
  forced?: { commandId: string; actorMemberId: number; reason: string; atMs: number };
  /** Server-owned receipt provenance for an acknowledged A-Day business-rule
   * departure. It permits replay of that exact pick, never client authority. */
  aDayOverride?: {
    commandId: string;
    actorMemberId: number;
    reason: string;
    positionId: string;
    aDay: import('@mbfd/a-day').ADayValue;
    warningCodes: readonly string[];
  };
  /** Voluntary overlays selected from frozen qualified populations. */
  membershipIds?: readonly string[];
  termDeparture?: import('@mbfd/shared').TermDepartureElection & {
    commandId: string;
    actorMemberId: number;
    recordedAtMs: number;
  };
  /** Present for frozen policies selecting position and A-Day together. */
  aDay?: import('@mbfd/a-day').ADayValue;
  memberId: number;
  ordinal: number;
  bidId: string;
}

/** Durable active-Bid projection shared by Mock and Real. Policy itself remains in
 * the immutable snapshot; this stores only progress and supersession facts. */
export interface LiveBidProgress {
  /** Audited, session-only duty overlays. Official rank and staffing remain frozen. */
  exceptionalAssignments?: readonly {
    assignmentId: string;
    commandId: string;
    memberId: number;
    roleLabel: string;
    positionId: string | null;
    actorMemberId: number;
    reason: string;
    assignedAtMs: number;
    releasedAtMs: number | null;
    releaseCommandId: string | null;
  }[];
  /** Append-only compensating projection; immutable receipts/events retain
   * every original award. A revocation stays pending until explicitly replaced. */
  corrections?: readonly {
    bidId: string;
    commandId: string;
    originalBidId: string;
    originalCommandId: string;
    originalADayCommandId: string | null;
    specialtyRequest?: import('../lib/bid-corrections.js').CorrectionSpecialtyRequest;
    before: { positionId: string; fill: Fill; aDay: ADayPick | null };
    after: { positionId: string; fill: Fill } | null;
    resolvesCorrectionBidId: string | null;
    actorMemberId: number;
    reason: string;
    sequence: number;
    atMs: number;
  }[];
  specialtyResponses?: readonly {
    specialtyId: string;
    positionId: string;
    requesterMemberId: number;
    memberId: number;
    outcome: 'DECLINE' | 'PASS' | 'UNREACHABLE';
    reason: string;
    evidenceReference: string | null;
  }[];
  fallbackResponses?: readonly {
    policyId: string;
    tierId: string;
    positionId: string;
    memberId: number;
    outcome: 'DECLINE' | 'UNREACHABLE';
    reason: string;
    evidenceReference: string | null;
  }[];
  currentStageId: string | null;
  completedStageIds: readonly string[];
  pausedPhase: CurrentPhase | null;
  lastSelectionBidId: string | null;
  dispositions: readonly {
    memberId: number;
    disposition: string;
    stageId: string | null;
    reason: string;
    evidenceReference: string | null;
  }[];
  /** An interruption suspends the exact normal bidder without rewinding the queue. */
  specialty?: {
    specialtyId: string;
    positionId: string;
    suspendedBidderId: number;
    candidateMemberIds: readonly number[];
    candidateCursor: number;
  } | null;
  /** Read-only audience publication is deliberately independent from Bid execution. */
  presentation?: {
    mode: 'OFF' | 'LIVE' | 'HOLD';
    heldAtSeq: number | null;
    heldProjection: {
      currentBidderId: number | null;
      currentStageId: string | null;
      currentPhase: CurrentPhase;
      fills: Record<string, Fill>;
      bidOrder?: BidSessionState['bidOrder'];
      queueCursor?: number;
      specialty?: LiveBidProgress['specialty'];
      aDay?: BidSessionState['aDay'];
      exceptionalAssignments?: LiveBidProgress['exceptionalAssignments'];
      dispositions?: LiveBidProgress['dispositions'];
      returningMemberId?: number | null;
    } | null;
  } | null;
}

export interface BidSessionState {
  bidSessionId: string;
  currentPhase: CurrentPhase;
  currentBidderId: number | null;
  turnStartedAtMs: number;
  turnTimerSeconds: number;
  /** Canonical reversible pause instant. Epoch milliseconds freeze the turn
   * countdown across browser closure or coordinator reconstruction. Absent only
   * in historical states; resume gives those turns a fresh advisory clock. */
  turnPausedAtMs?: number | null;
  lastSeq: number;
  fills: Record<string, Fill>;
  bidOrder: ReadonlyArray<{
    ordinal: number;
    memberId: number;
    pool: 'OFC' | 'FF';
    stageId?: string | null;
  }>;
  queueCursor: number;
  frozenAt: number | null;
  /**
   * Phase-2 A-Day state. Null until the session transitions to `a_day_bid`.
   * Map types are persisted as arrays (PersistedADayState) for JSON round-trip.
   */
  aDay: PersistedADayState | null;
  live?: LiveBidProgress | null;
  /** Annual operations are canonical-state material and survive DO eviction. */
  annual?: AnnualOperationsState | null;
}

export function emptyBidSessionState(bidSessionId: string): BidSessionState {
  return {
    bidSessionId,
    currentPhase: 'config',
    currentBidderId: null,
    turnStartedAtMs: 0,
    turnTimerSeconds: 180,
    lastSeq: 0,
    fills: {},
    bidOrder: [],
    queueCursor: 0,
    frozenAt: null,
    aDay: null,
    live: null,
    annual: null,
  };
}

export function bidSessionStateStorageKey(bidSessionId: string): string {
  return `bs:${bidSessionId}:state`;
}

export async function loadBidSessionState(
  storage: DOStorageLike,
  bidSessionId: string,
): Promise<BidSessionState> {
  const persisted = await storage.get<BidSessionState>(bidSessionStateStorageKey(bidSessionId));
  if (!persisted) return emptyBidSessionState(bidSessionId);
  // Forward-compatibility: legacy snapshots predating Plan 07 lack `aDay`.
  return {
    ...persisted,
    aDay: persisted.aDay ?? null,
    live: persisted.live ?? null,
    annual: persisted.annual ?? null,
  };
}

export async function persistBidSessionState(
  storage: DOStorageLike,
  state: BidSessionState,
): Promise<void> {
  await storage.put<BidSessionState>(bidSessionStateStorageKey(state.bidSessionId), state);
}
