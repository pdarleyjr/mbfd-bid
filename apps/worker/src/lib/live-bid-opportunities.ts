/** Session-only opportunity changes never rewrite the frozen definition or
 * represent a position as occupied. Omitted metadata preserves old sessions. */
type OpportunityState = { live?: { withdrawnPositionIds?: readonly string[] } | null };
type TurnState = {
  bidOrder: readonly { memberId: number; stageId?: string | null }[];
  live?: { completedStageIds?: readonly string[] } | null;
};

export function withdrawnLivePositionIds(state: OpportunityState): ReadonlySet<string> {
  return new Set(state.live?.withdrawnPositionIds ?? []);
}

export function activeLivePositionIds(state: OpportunityState, ids: readonly string[]): string[] {
  const withdrawn = withdrawnLivePositionIds(state);
  return ids.filter((id) => !withdrawn.has(id));
}

export function liveTurnIsCompleted(
  state: Pick<TurnState, 'live'>,
  turn: { stageId?: string | null },
): boolean {
  return turn.stageId != null && (state.live?.completedStageIds ?? []).includes(turn.stageId);
}

/** Completion applies to exact frozen turns, not a person's rank. A member
 * in a completed specialty stage keeps a still-open ordinary turn. Missing
 * historical turn evidence cannot invent a completed right. */
export function liveMemberHasOpenTurn(state: TurnState, memberId: number): boolean {
  const turns = state.bidOrder.filter((turn) => turn.memberId === memberId);
  return turns.length === 0 || turns.some((turn) => !liveTurnIsCompleted(state, turn));
}
