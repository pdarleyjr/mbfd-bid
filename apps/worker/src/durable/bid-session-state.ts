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
  memberId: number;
  ordinal: number;
  bidId: string;
}

/** Durable, reconstructible live-only projection.  Policy itself remains in
 * the immutable snapshot; this stores only progress and supersession facts. */
export interface LiveBidProgress {
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
    } | null;
  } | null;
}

export interface BidSessionState {
  bidSessionId: string;
  currentPhase: CurrentPhase;
  currentBidderId: number | null;
  turnStartedAtMs: number;
  turnTimerSeconds: number;
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
