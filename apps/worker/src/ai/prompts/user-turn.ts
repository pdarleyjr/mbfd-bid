export interface TurnInput {
  phase: 'config' | 'position_bid' | 'a_day_phase' | 'paused' | 'completed';
  currentBidderEmployeeId: string | null;
  queue: string[];
  positionFills: Record<string, string>;
  remainingPositionIds: string[];
  question: string;
}

export function turnBlock(t: TurnInput): Array<{ type: 'text'; text: string }> {
  const state = JSON.stringify({
    phase: t.phase,
    current_bidder: t.currentBidderEmployeeId,
    queue: t.queue,
    position_fills: t.positionFills,
    remaining_positions: t.remainingPositionIds,
  });
  return [
    {
      type: 'text',
      text: `# Current bid state\n${state}\n\n# Question\n${t.question}\n\nReply with ONLY the JSON object specified in the system prompt — no prose, no fences.`,
    },
  ];
}
