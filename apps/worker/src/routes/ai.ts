import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { ADVISORY_MODEL_NAME, AIError, WorkersAIClient } from '../ai/client.js';
import { checkAiGate } from '../ai/gate.js';
import { systemPrompt } from '../ai/prompts/system-2026.js';
import { rosterPrompt } from '../ai/prompts/user-roster.js';
import { turnPrompt, userPrompt } from '../ai/prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from '../ai/session-loader.js';
import { getDb } from '../db/index.js';
import { aiAdvisories } from '../db/schema.js';
import type { WorkerEnv } from '../types/env.js';
import { requireAdmin } from './admin/middleware.js';

type AiEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const r = new Hono<AiEnv>();
r.use('*', requireAdmin);

function aiBudgetCapCents(env: WorkerEnv): number {
  return Number(env.AI_BUDGET_CAP_CENTS ?? 0);
}

r.get('/advise-current', async (c) => {
  const sessionId = c.req.query('session_id');
  if (!sessionId) return c.json({ error: 'session_id_required' }, 400);

  const gate = await checkAiGate(c.env, sessionId);
  if (!gate.ok) return c.json({ disabled: true, reason: gate.reason }, 503);

  const startedAt = Date.now();
  const roster = await loadRosterForSession(c.env, sessionId);
  const state = await loadTurnStateForSession(c.env, sessionId);

  const client = new WorkersAIClient(c.env);
  const sys = systemPrompt();
  const rosterText = rosterPrompt(roster);
  const turnText = turnPrompt({
    ...state,
    question: "Advise on the current bidder's upcoming pick.",
  });
  const user = userPrompt({ roster: rosterText, turn: turnText });
  const envelope = await client.adviseCurrent({
    bidSessionId: sessionId,
    system: sys,
    user,
  });

  // Plan 07 cross-plan hook: when Phase 2 is active, populate the optional
  // `aDayInvariantSnapshot` so the advisory carries the current group/officer
  // capacity board alongside the AI recommendation. Populated from the DO
  // snapshot via a non-blocking best-effort fetch. The field is `z.record(z.unknown()).optional()`
  // (see Plan 06 AdvisorySchema), so the shape is permissive.
  // TODO(plan-09): tighten the snapshot shape into a typed payload.
  try {
    const doId = c.env.BID_SESSION.idFromName(sessionId);
    const stub = c.env.BID_SESSION.get(doId);
    const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
    if (snap.ok) {
      const session = (await snap.json()) as { currentPhase?: string; aDay?: unknown };
      if (session.currentPhase === 'a_day_bid' && session.aDay != null) {
        envelope.advisory.aDayInvariantSnapshot = session.aDay as Record<string, unknown>;
      }
    }
  } catch {
    // Snapshot is advisory-only; failures must not break the AI response.
  }

  if (!envelope.stale && envelope.ai_advisory_id) {
    const db = getDb(c.env.DB);
    const promptHash = await client.hashPrompt(sys, rosterText, turnText);
    await db.insert(aiAdvisories).values({
      id: envelope.ai_advisory_id,
      bidSessionId: sessionId,
      memberId: null,
      positionId: null,
      triggeredBy: 'turn_start',
      model: ADVISORY_MODEL_NAME,
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

r.get('/cost', async (c) => {
  const sessionId = c.req.query('session_id');
  // Plan 09 / Rehearsal Tooling — Task R10. When session_id is omitted, fall
  // back to the aggregate running total stored under `ai_cost_cents_total`.
  // If that key is absent (e.g. before any AI work has run), sum the keys
  // under `ai_cost_cents:*` so the rehearsal dashboard still has something
  // meaningful to render.
  if (!sessionId) {
    const stored = await c.env.AI_KV.get('ai_cost_cents_total');
    if (stored !== null) {
      return c.json({ cost_cents: Number(stored), cap_cents: aiBudgetCapCents(c.env) });
    }
    let total = 0;
    try {
      const list = await c.env.AI_KV.list({ prefix: 'ai_cost_cents:' });
      for (const k of list.keys) {
        const v = await c.env.AI_KV.get(k.name);
        if (v !== null) total += Number(v);
      }
    } catch {
      // best-effort — return whatever we managed to accumulate
    }
    return c.json({ cost_cents: total, cap_cents: aiBudgetCapCents(c.env) });
  }
  const used = Number((await c.env.AI_KV.get(`ai_cost_cents:${sessionId}`)) ?? 0);
  return c.json({ cost_cents: used, cap_cents: aiBudgetCapCents(c.env) });
});

r.get('/forecast', async (c) => {
  const sessionId = c.req.query('session_id');
  if (!sessionId) return c.json({ error: 'session_id_required' }, 400);
  const raw = await c.env.AI_KV.get(`ai_forecast:${sessionId}`);
  if (!raw) return c.json({ error: 'no_forecast_cached' }, 404);
  return c.body(raw, 200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, max-age=30',
  });
});

const DeepBodySchema = z.object({
  session_id: z.string().min(1),
  question: z.string().min(1).max(2000),
});

r.post('/advise-deep', async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = DeepBodySchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'bad_body' }, 400);
  const { session_id, question } = parsed.data;

  const gate = await checkAiGate(c.env, session_id);
  if (!gate.ok) return c.json({ disabled: true, reason: gate.reason }, 503);

  const roster = await loadRosterForSession(c.env, session_id);
  const state = await loadTurnStateForSession(c.env, session_id);
  const client = new WorkersAIClient(c.env);

  // Workers AI streams OpenAI-style SSE (`data: {"response":"…"}\n\n`)
  // chunks. We forward the upstream stream verbatim so the client gets the
  // exact same wire format it would from any other OpenAI-compatible endpoint.
  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = await client.adviseDeepStream({
      bidSessionId: session_id,
      system: systemPrompt(),
      user: userPrompt({
        roster: rosterPrompt(roster),
        turn: turnPrompt({ ...state, question }),
      }),
    });
  } catch (err) {
    if (err instanceof AIError && err.kind === 'disabled') {
      return c.json({ disabled: true, reason: err.message }, 503);
    }
    return c.json({ error: 'upstream' }, 502);
  }

  return new Response(upstream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export default r;
