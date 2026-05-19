import type { WorkerEnv } from '../types/env.js';
import { AnthropicAIClient } from './client.js';
import { systemBlock } from './prompts/system-2026.js';
import { rosterBlock } from './prompts/user-roster.js';
import { turnBlock } from './prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from './session-loader.js';

/**
 * Fire-and-forget pre-fetch. Should be called from the DO's onTurnAdvance
 * hook (Plan 04) approximately 1 second before the on-deck member's turn
 * becomes current.
 */
export async function warmCacheForOnDeck(
  env: WorkerEnv,
  bidSessionId: string,
  onDeckEmployeeId: string,
): Promise<void> {
  const flag = await env.AI_KV.get(env.AI_FEATURE_FLAG_KEY);
  if (flag === 'false') return;

  const roster = await loadRosterForSession(env, bidSessionId);
  const state = await loadTurnStateForSession(env, bidSessionId);
  // Override current bidder to the on-deck member so the prompt reflects
  // who the upcoming pick is for.
  const turn = turnBlock({
    ...state,
    currentBidderEmployeeId: onDeckEmployeeId,
    question: 'Pre-fetch: advise on the upcoming pick for the on-deck bidder.',
  });

  const client = new AnthropicAIClient(env);
  try {
    await client.preFetch({
      bidSessionId,
      system: systemBlock(),
      roster: rosterBlock(roster),
      turn,
      timeoutMs: 4000,
    });
  } catch {
    // Pre-fetch failures are silent — turn-start will retry.
  }
}
