import { eq } from 'drizzle-orm';
import { AnthropicAIClient } from './ai/client.js';
import { systemBlock } from './ai/prompts/system-2026.js';
import { rosterBlock } from './ai/prompts/user-roster.js';
import { turnBlock } from './ai/prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from './ai/session-loader.js';
import { getDb } from './db/index.js';
import { bidSessions } from './db/schema.js';
import type { WorkerEnv } from './types/env.js';

const FORECAST_QUESTION =
  'Provide a department-wide forecast: which credentials are running short, ' +
  'which positions look likely to go unfilled, which members are most affected. ' +
  'Return ONLY the JSON object specified in the system prompt.';

export async function handleScheduled(env: WorkerEnv): Promise<void> {
  const db = getDb(env.DB);
  const live = await db
    .select({ id: bidSessions.id })
    .from(bidSessions)
    .where(eq(bidSessions.currentPhase, 'position_bid'))
    .all();
  if (live.length === 0) return;

  const client = new AnthropicAIClient(env);
  for (const s of live) {
    const roster = await loadRosterForSession(env, s.id);
    const state = await loadTurnStateForSession(env, s.id);
    try {
      const envelope = await client.adviseCurrent({
        bidSessionId: s.id,
        system: systemBlock(),
        roster: rosterBlock(roster),
        turn: turnBlock({ ...state, question: FORECAST_QUESTION }),
      });
      await env.AI_KV.put(`ai_forecast:${s.id}`, JSON.stringify(envelope), {
        expirationTtl: 60 * 60,
      });
    } catch {
      // best-effort; consumers see the old cached value or 404
    }
  }
}
