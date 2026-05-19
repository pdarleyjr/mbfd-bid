export interface DOStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
}

export type CurrentPhase = 'config' | 'position_bid' | 'r_day_bid' | 'paused' | 'complete';

export interface Fill {
  memberId: number;
  ordinal: number;
  bidId: string;
}

export interface BidSessionState {
  bidSessionId: string;
  currentPhase: CurrentPhase;
  currentBidderId: number | null;
  turnStartedAtMs: number;
  turnTimerSeconds: number;
  lastSeq: number;
  fills: Record<string, Fill>;
  bidOrder: ReadonlyArray<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }>;
  queueCursor: number;
  frozenAt: number | null;
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
  };
}

function keyFor(bidSessionId: string): string {
  return `bs:${bidSessionId}:state`;
}

export async function loadBidSessionState(
  storage: DOStorageLike,
  bidSessionId: string,
): Promise<BidSessionState> {
  const persisted = await storage.get<BidSessionState>(keyFor(bidSessionId));
  return persisted ?? emptyBidSessionState(bidSessionId);
}

export async function persistBidSessionState(
  storage: DOStorageLike,
  state: BidSessionState,
): Promise<void> {
  await storage.put<BidSessionState>(keyFor(state.bidSessionId), state);
}
