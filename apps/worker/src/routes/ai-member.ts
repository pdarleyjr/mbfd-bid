/**
 * Member-side AI advisory routes. Mounted at `/api/ai`. Unlike the admin AI
 * router (`/api/admin/ai`), these endpoints are accessible to any logged-in
 * member — but only return data when the calling member is the active
 * bidder. This guarantees that the advisory the chief sees in the admin
 * console is the same advisory the member sees on their phone the moment
 * the queue advances to their turn.
 *
 * Routes:
 *   GET /advise-me?session_id=…
 *     401 missing_auth — no JWT
 *     400 session_id_required
 *     403 not_your_turn — JWT subject ≠ board.currentBidderId
 *     503 disabled — AI gate off
 *     200 AdvisoryEnvelope — same shape as /api/admin/ai/advise-current
 */

import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ADVISORY_MODEL_NAME, WorkersAIClient } from '../ai/client.js';
import { checkAiGate } from '../ai/gate.js';
import { systemPrompt } from '../ai/prompts/system-2026.js';
import { rosterPrompt } from '../ai/prompts/user-roster.js';
import { turnPrompt, userPrompt } from '../ai/prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from '../ai/session-loader.js';
import { getDb } from '../db/index.js';
import { aiAdvisories } from '../db/schema.js';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import type { WorkerEnv } from '../types/env.js';

type AiMemberEnv = { Bindings: WorkerEnv };

const r = new Hono<AiMemberEnv>();

async function requireMemberJwt(
  authHeader: string | undefined,
  signingKey: string,
): Promise<JwtPayload | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return await verifyJwt(authHeader.slice(7).trim(), signingKey);
  } catch {
    return null;
  }
}

r.get('/advise-me', async (c) => {
  const sessionId = c.req.query('session_id');
  if (!sessionId) return c.json({ error: 'session_id_required' }, 400);

  const env = validateEnv(c.env);
  const claims = await requireMemberJwt(c.req.header('Authorization'), env.JWT_SIGNING_KEY);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);

  // Gate: caller must be the current bidder for this session.
  const doId = c.env.BID_SESSION.idFromName(sessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  if (!snap.ok) return c.json({ error: 'session_not_found' }, 404);
  const session = (await snap.json()) as { currentBidderId?: number | null };
  if (session.currentBidderId !== claims.sub) {
    return c.json({ error: 'not_your_turn' }, 403);
  }

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
    question: 'Advise the active bidder on their upcoming pick.',
  });
  const user = userPrompt({ roster: rosterText, turn: turnText });
  const envelope = await client.adviseCurrent({
    bidSessionId: sessionId,
    system: sys,
    user,
  });

  // Audit row so member-side advisories appear in the same advisory log as
  // admin-side advisories. `member_id` ties the row to the requester for
  // post-hoc analysis.
  if (!envelope.stale && envelope.ai_advisory_id) {
    try {
      const db = getDb(c.env.DB);
      const promptHash = await client.hashPrompt(sys, rosterText, turnText);
      await db.insert(aiAdvisories).values({
        id: envelope.ai_advisory_id,
        bidSessionId: sessionId,
        memberId: claims.sub,
        positionId: null,
        // Reuse `turn_start` — member fetches the advisory the moment their
        // turn starts; no separate enum value avoids a migration.
        triggeredBy: 'turn_start',
        model: ADVISORY_MODEL_NAME,
        promptHash,
        responseJson: JSON.stringify(envelope.advisory),
        renderedMarkdown: envelope.advisory.summary,
        latencyMs: Math.max(0, Date.now() - startedAt),
        costCents: 0,
        cacheHitRatio: 0,
      });
    } catch (err) {
      // Audit write is best-effort — never block the member's advisory on it.
      console.error('[ai-member.advise-me] audit insert failed', err);
    }
  }

  return c.json(envelope);
});

export default r;
