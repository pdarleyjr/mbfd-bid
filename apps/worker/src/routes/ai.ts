import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { AnthropicAIClient } from '../ai/client.js';
import { systemBlock } from '../ai/prompts/system-2026.js';
import { rosterBlock } from '../ai/prompts/user-roster.js';
import { turnBlock } from '../ai/prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from '../ai/session-loader.js';
import { getDb } from '../db/index.js';
import { aiAdvisories } from '../db/schema.js';
import type { WorkerEnv } from '../types/env.js';
import { requireAdmin } from './admin/middleware.js';

type AiEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const r = new Hono<AiEnv>();
r.use('*', requireAdmin);

r.get('/advise-current', async (c) => {
  const sessionId = c.req.query('session_id');
  if (!sessionId) return c.json({ error: 'session_id_required' }, 400);

  // Feature flag — fail fast before building prompts
  const flag = await c.env.AI_KV.get(c.env.AI_FEATURE_FLAG_KEY);
  if (flag === 'false') return c.json({ disabled: true, reason: 'feature_flag_off' }, 503);

  const startedAt = Date.now();
  const roster = await loadRosterForSession(c.env, sessionId);
  const state = await loadTurnStateForSession(c.env, sessionId);

  const client = new AnthropicAIClient(c.env);
  const sys = systemBlock();
  const rosterPrompt = rosterBlock(roster);
  const turn = turnBlock({
    ...state,
    question: "Advise on the current bidder's upcoming pick.",
  });
  const envelope = await client.adviseCurrent({
    bidSessionId: sessionId,
    system: sys,
    roster: rosterPrompt,
    turn,
  });

  if (!envelope.stale && envelope.ai_advisory_id) {
    const db = getDb(c.env.DB);
    const promptHash = await client.hashPrompt(
      JSON.stringify(sys),
      JSON.stringify(rosterPrompt),
      JSON.stringify(turn),
    );
    await db.insert(aiAdvisories).values({
      id: envelope.ai_advisory_id,
      bidSessionId: sessionId,
      memberId: null,
      positionId: null,
      triggeredBy: 'turn_start',
      model: 'claude-sonnet-4-6',
      promptHash,
      responseJson: JSON.stringify(envelope.advisory),
      renderedMarkdown: envelope.advisory.summary,
      latencyMs: Math.max(0, Date.now() - startedAt),
      costCents: 0,
      cacheHitRatio: 0,
    });
  }

  return c.json(envelope);
});

export default r;
