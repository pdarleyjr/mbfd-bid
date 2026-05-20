import type { WorkerEnv } from '../types/env.js';
import { WorkersAIClient } from './client.js';
import { systemPrompt } from './prompts/system-2026.js';
import { rosterPrompt } from './prompts/user-roster.js';
import { turnPrompt, userPrompt } from './prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from './session-loader.js';

/**
 * Fire-and-forget pre-fetch. Should be called from the DO's onTurnAdvance
 * hook (Plan 04) approximately 1 second before the on-deck member's turn
 * becomes current. The name "cache-warm" predates the Workers AI swap; the
 * Workers AI binding does not have prompt caching, but pre-running the
 * advisor still warms the `ai_last_good:<sessionId>` KV entry so the
 * turn-start UI shows the previous answer instantly while the live call
 * completes in the background.
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
  const turnText = turnPrompt({
    ...state,
    currentBidderEmployeeId: onDeckEmployeeId,
    question: 'Pre-fetch: advise on the upcoming pick for the on-deck bidder.',
  });

  const client = new WorkersAIClient(env);
  try {
    await client.preFetch({
      bidSessionId,
      system: systemPrompt(),
      user: userPrompt({ roster: rosterPrompt(roster), turn: turnText }),
      timeoutMs: 4000,
    });
  } catch {
    // Pre-fetch failures are silent — turn-start will retry.
  }
}
