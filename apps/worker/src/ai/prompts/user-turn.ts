export interface TurnInput {
  phase: 'config' | 'position_bid' | 'a_day_phase' | 'paused' | 'completed';
  currentBidderEmployeeId: string | null;
  queue: string[];
  positionFills: Record<string, string>;
  remainingPositionIds: string[];
  question: string;
}

/**
 * Returns the per-turn portion of the user prompt as plain text. The Workers
 * AI swap (2026-05) merges this with the roster portion into one `user`
 * message; see `userPrompt()` for the combined string.
 */
export function turnPrompt(t: TurnInput): string {
  const state = JSON.stringify({
    phase: t.phase,
    current_bidder: t.currentBidderEmployeeId,
    queue: t.queue,
    position_fills: t.positionFills,
    remaining_positions: t.remainingPositionIds,
  });
  return `# Current bid state\n${state}\n\n# Question\n${t.question}\n\nReply with ONLY the JSON object specified in the system prompt — no prose, no fences.`;
}

/** @deprecated Use `turnPrompt()`. Kept for one release. */
export function turnBlock(t: TurnInput): string {
  return turnPrompt(t);
}

/**
 * Combine roster text + turn text into a single user message body. This is
 * the canonical user prompt for the Workers AI swap; route handlers call
 * `userPrompt({ roster: rosterPrompt(...), turn: turnPrompt(...) })`.
 */
export function userPrompt(parts: { roster: string; turn: string }): string {
  return `${parts.roster}\n\n${parts.turn}`;
}
