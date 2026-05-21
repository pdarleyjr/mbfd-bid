// Plan 09 / Rehearsal Tooling — admin endpoints for mock-draft sessions.
//
// Routes:
//   POST   /api/admin/rehearsal/:sessionId/mark-mock   (Task R3)
//   POST   /api/admin/rehearsal/:sessionId/reset-mock  (Task R4)
//   POST   /api/admin/rehearsal/:sessionId/auto-bid    (Task R5)
//   POST   /api/admin/rehearsal/findings               (Task R6)
//   GET    /api/admin/rehearsal/findings?session_id=…  (Task R6)
//
// All routes require admin role (`requireAdmin`). Mark-mock is intentionally
// NOT behind `requireStepUpAuth` because it is a no-op until the operator
// also runs reset-mock / auto-bid (which themselves are 403 unless is_mock=1).

import { zValidator } from '@hono/zod-validator';
import { type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import type { JwtPayload } from '@mbfd/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { WorkersAIClient } from '../../ai/client.js';
import { checkAiGate } from '../../ai/gate.js';
import { systemPrompt } from '../../ai/prompts/system-2026.js';
import { rosterPrompt } from '../../ai/prompts/user-roster.js';
import { turnPrompt, userPrompt } from '../../ai/prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from '../../ai/session-loader.js';
import { type DB, getDb } from '../../db/index.js';
import {
  aDayPicks,
  bidOrder,
  bidSessions,
  bids,
  credentials,
  memberCredentials,
  members,
  positionRules,
  rehearsalFindings,
  ruleBooks,
} from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { computeBidOrder } from '../../lib/bid-order.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

interface MemberWithCreds {
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  rscSeniority: number;
  rankSeniority: number | undefined;
  isProbationary: boolean;
  credentials: { name: string }[];
}

async function loadMemberWithCreds(db: DB, memberId: number): Promise<MemberWithCreds | null> {
  const m = await db.select().from(members).where(eq(members.id, memberId)).get();
  if (m === undefined) return null;
  const creds = await db
    .select({ name: credentials.name })
    .from(memberCredentials)
    .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
    .where(eq(memberCredentials.memberId, memberId))
    .all();
  return {
    employeeId: m.employeeId,
    firstName: m.firstName,
    lastName: m.lastName,
    rank: m.rank,
    rscSeniority: m.rscSeniority,
    rankSeniority: m.rankSeniority ?? undefined,
    isProbationary: m.isProbationary,
    credentials: creds.map((c) => ({ name: c.name })),
  };
}

/**
 * Task R3 — POST /api/admin/rehearsal/:sessionId/mark-mock
 *
 * Idempotently sets `bid_sessions.is_mock = 1` for the given session. This
 * MUST be done BEFORE any picks happen — once a session is marked mock, the
 * portal-writeback consumer (Task R8) will skip every bid in it.
 *
 * Returns 404 if the session does not exist. 200 on success (whether or not
 * it was already marked).
 */
router.post('/:sessionId/mark-mock', async (c) => {
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (s.isMock) {
    return c.json({ id: sessionId, is_mock: true, idempotent: true });
  }
  await db.update(bidSessions).set({ isMock: true }).where(eq(bidSessions.id, sessionId));
  return c.json({ id: sessionId, is_mock: true, idempotent: false });
});

/**
 * Task R4 — POST /api/admin/rehearsal/:sessionId/reset-mock
 *
 * Wipes Phase 1 bids + Phase 2 a_day picks, rewinds the session row to the
 * starting `position_bid` state, and asks the BidSession DO to reset its
 * in-memory + persisted state. The audit chain is intentionally NOT touched:
 * the rehearsal record itself is part of the legal trail.
 *
 * Returns 403 if the session isn't marked mock. 404 if it doesn't exist.
 * 204 on success (no body).
 */
router.post('/:sessionId/reset-mock', async (c) => {
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);
  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (!s.isMock) {
    return c.json({ error: 'not_a_mock_session' }, 403);
  }

  // Order matters: clear child rows first to avoid FK conflicts in production
  // D1 (test harness disables FKs, but production keeps them on).
  await db.delete(bids).where(eq(bids.bidSessionId, sessionId));
  await db.delete(aDayPicks).where(eq(aDayPicks.bidSessionId, sessionId));

  // Pick the first ordinal as the next current bidder. If the session has no
  // bid_order yet (never started) we leave currentBidderId null.
  const firstInOrder = await db
    .select()
    .from(bidOrder)
    .where(eq(bidOrder.bidSessionId, sessionId))
    .orderBy(asc(bidOrder.ordinal))
    .get();

  await db
    .update(bidSessions)
    .set({
      currentPhase: 'position_bid',
      currentBidderId: firstInOrder?.memberId ?? null,
      currentTurnStartedAt: null,
      pausedAt: null,
      completedAt: null,
      frozenAt: null,
    })
    .where(eq(bidSessions.id, sessionId));

  // Best-effort: tell the DO to wipe its in-memory state. If BID_SESSION is
  // a test stub, the call may throw — we swallow so the D1 reset still
  // surfaces as 204 to the admin.
  try {
    const doId = c.env.BID_SESSION.idFromName(sessionId);
    const stub = c.env.BID_SESSION.get(doId);
    await stub.fetch('http://do/reset-mock', { method: 'POST' });
  } catch (err) {
    console.error('[rehearsal] DO reset-mock call failed (best-effort)', err);
  }

  return new Response(null, { status: 204 });
});

const AutoBidBodySchema = z.object({
  count: z.number().int().positive().max(200),
  strategy: z.enum(['ai_top', 'first_eligible']),
});

async function loadActiveRulesForYear(
  db: DB,
  effectiveYear: number,
): Promise<{ ruleBookVersion: string; rules: PositionRule[] }> {
  const rb = await db
    .select()
    .from(ruleBooks)
    .where(and(eq(ruleBooks.status, 'active'), eq(ruleBooks.effectiveYear, effectiveYear)))
    .get();
  if (rb === undefined) {
    return { ruleBookVersion: '', rules: [] };
  }
  const rows = await db
    .select()
    .from(positionRules)
    .where(eq(positionRules.ruleBookVersion, rb.version))
    .all();
  return {
    ruleBookVersion: rb.version,
    rules: rows.map((r) => ({
      positionId: r.positionId,
      ruleBookVersion: r.ruleBookVersion,
      requiredCriteria: JSON.parse(r.requiredCriteriaJson) as PositionRule['requiredCriteria'],
      pointsPreference: JSON.parse(r.pointsPreferenceJson) as PositionRule['pointsPreference'],
      tieBreakChain: JSON.parse(r.tieBreakChainJson) as PositionRule['tieBreakChain'],
    })),
  };
}

async function getCurrentBidderFromDO(
  env: WorkerEnv,
  sessionId: string,
  fallbackFromDb: number | null,
): Promise<number | null> {
  try {
    const id = env.BID_SESSION.idFromName(sessionId);
    const stub = env.BID_SESSION.get(id);
    const res = await stub.fetch(`http://do/${sessionId}/snapshot`);
    if (!res.ok) return fallbackFromDb;
    const snap = (await res.json()) as { currentBidderId?: number | null };
    return snap.currentBidderId ?? fallbackFromDb;
  } catch {
    return fallbackFromDb;
  }
}

/**
 * W42 — Call the AI advisor directly (NOT via a recursive `app.fetch`) and
 * return the top-pick `position_id`. The logic mirrors `GET
 * /api/admin/ai/advise-current` minus the HTTP wrapper and the D1 advisory
 * row write (rehearsal pre-picks shouldn't be cluttering the advisories
 * table). On ANY failure path — AI gate closed, gateway error, schema
 * mismatch — we return null and the caller falls back to `first_eligible`.
 */
async function getAiTopPick(env: WorkerEnv, sessionId: string): Promise<string | null> {
  try {
    const gate = await checkAiGate(env, sessionId);
    if (!gate.ok) return null;
    const roster = await loadRosterForSession(env, sessionId);
    const state = await loadTurnStateForSession(env, sessionId);
    const client = new WorkersAIClient(env);
    const envelope = await client.adviseCurrent({
      bidSessionId: sessionId,
      system: systemPrompt(),
      user: userPrompt({
        roster: rosterPrompt(roster),
        turn: turnPrompt({
          ...state,
          question: "Advise on the current bidder's upcoming pick.",
        }),
      }),
    });
    const pick = envelope.advisory.eligible_recommendations?.[0]?.position_id;
    return typeof pick === 'string' && pick.length > 0 ? pick : null;
  } catch {
    return null;
  }
}

/**
 * Task R5 — POST /api/admin/rehearsal/:sessionId/auto-bid
 *
 * Body: { count, strategy }
 *   count    1..200 picks to attempt
 *   strategy 'ai_top' | 'first_eligible'
 *
 * Loops up to `count` picks, finding the current bidder via the DO snapshot
 * (falls back to `bid_sessions.current_bidder_id`), evaluating eligibility
 * against the active rule book, and inserting a proxy bid row + audit entry.
 *
 * Stops early when:
 *   - session reaches `complete` phase
 *   - the same eligibility check fails for 5 consecutive members (no_eligible)
 *   - count is reached
 *
 * Returns 200 with `{ picksMade, stoppedReason, detail? }`.
 * Returns 207 multi-status when picks were made but the loop hit no_eligible.
 * Returns 403 if the session is not marked mock.
 */
router.post('/:sessionId/auto-bid', zValidator('json', AutoBidBodySchema), async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (!session.isMock) {
    return c.json({ error: 'not_a_mock_session' }, 403);
  }
  if (session.currentPhase === 'complete') {
    return c.json({ picksMade: 0, stoppedReason: 'complete' });
  }

  const { rules } = await loadActiveRulesForYear(db, session.bidYear);
  if (rules.length === 0) {
    return c.json({ picksMade: 0, stoppedReason: 'error', detail: 'no_active_rule_book' }, 200);
  }
  const rulesByPosition = new Map(rules.map((r) => [r.positionId, r]));

  let orderRows = await db
    .select()
    .from(bidOrder)
    .where(eq(bidOrder.bidSessionId, sessionId))
    .orderBy(asc(bidOrder.ordinal))
    .all();

  // Bootstrap: mock sessions created via /admin/sessions/new sit in `config`
  // phase with an empty bid_order until someone manually calls the start
  // endpoint. Rehearsal flow should be one-click — if bid_order is empty
  // here, compute it from the members roster (same seniority + pool rules
  // session-start uses), insert it, and advance the session to position_bid
  // with currentBidderId set to ordinal 1. The auto-bid loop then proceeds
  // naturally.
  let bootstrapped = false;
  if (orderRows.length === 0) {
    const memberRows = await db
      .select({
        id: members.id,
        bidCategory: members.bidCategory,
        rscSeniority: members.rscSeniority,
        rankSeniority: members.rankSeniority,
      })
      .from(members)
      .all();
    const computed = computeBidOrder(memberRows);
    if (computed.length === 0) {
      return c.json({ picksMade: 0, stoppedReason: 'error', detail: 'no_members_to_bid' }, 200);
    }
    await db.insert(bidOrder).values(
      computed.map((e) => ({
        bidSessionId: sessionId,
        ordinal: e.ordinal,
        memberId: e.memberId,
        pool: e.pool,
      })),
    );
    const first = computed[0];
    const firstMemberId = first ? first.memberId : null;
    await db
      .update(bidSessions)
      .set({
        currentPhase: 'position_bid',
        currentBidderId: firstMemberId,
        startedAt: session.startedAt ?? new Date(),
      })
      .where(eq(bidSessions.id, sessionId));
    orderRows = await db
      .select()
      .from(bidOrder)
      .where(eq(bidOrder.bidSessionId, sessionId))
      .orderBy(asc(bidOrder.ordinal))
      .all();
    bootstrapped = true;
  }
  if (orderRows.length === 0) {
    return c.json({ picksMade: 0, stoppedReason: 'error', detail: 'no_bid_order' }, 200);
  }
  const memberIdToNextMember = new Map<number, number | null>();
  for (let i = 0; i < orderRows.length; i++) {
    const cur = orderRows[i];
    const nxt = orderRows[i + 1];
    if (cur !== undefined) {
      memberIdToNextMember.set(cur.memberId, nxt?.memberId ?? null);
    }
  }

  const claims = c.get('claims');
  const adminActorId = claims.sub > 0 ? claims.sub : 0;

  let picksMade = 0;
  let consecutiveNoEligible = 0;
  let stoppedReason: 'count_reached' | 'complete' | 'no_eligible' | 'error' = 'count_reached';
  let detail: string | undefined;
  // If we just bootstrapped, the DO snapshot doesn't have the new ordering
  // yet, so don't ask it — take the first ordinal from the freshly-inserted
  // bid_order rows. Otherwise prefer the DO (it's authoritative once the
  // session is live).
  const firstOrderRow = orderRows[0];
  const firstFromOrder = firstOrderRow !== undefined ? firstOrderRow.memberId : null;
  let currentBidder = bootstrapped
    ? firstFromOrder
    : await getCurrentBidderFromDO(c.env, sessionId, session.currentBidderId ?? null);
  if (bootstrapped) {
    await writeAuditLog(db, {
      bidSessionId: sessionId,
      actorType: 'admin',
      actorId: adminActorId,
      action: 'session_start',
      targetKind: 'bid_session',
      targetId: sessionId,
      reason: 'rehearsal auto-bid bootstrap',
      beforeState: { current_phase: 'config' },
      afterState: { current_phase: 'position_bid', bid_order_rows: orderRows.length },
    });
  }

  for (let i = 0; i < body.count; i++) {
    if (currentBidder === null) {
      stoppedReason = 'complete';
      break;
    }

    const member = await loadMemberWithCreds(db, currentBidder);
    if (member === null) {
      stoppedReason = 'error';
      detail = `member ${currentBidder} not found`;
      break;
    }

    const taken = await db
      .select({ positionId: bids.positionId })
      .from(bids)
      .where(eq(bids.bidSessionId, sessionId))
      .all();
    const takenSet = new Set(taken.map((t) => t.positionId));

    // Determine candidate ordering. ai_top tries the AI's top pick first;
    // first_eligible just walks the rules in their declared order.
    let candidatePositions = rules.map((r) => r.positionId).filter((p) => !takenSet.has(p));
    if (body.strategy === 'ai_top') {
      const aiTop = await getAiTopPick(c.env, sessionId);
      if (aiTop !== null && !takenSet.has(aiTop)) {
        candidatePositions = [aiTop, ...candidatePositions.filter((p) => p !== aiTop)];
      }
    }

    let chosenPositionId: string | null = null;
    for (const positionId of candidatePositions) {
      const rule = rulesByPosition.get(positionId);
      if (rule === undefined) continue;
      const r = evaluateEligibility(member, rule);
      if (r.eligible) {
        chosenPositionId = positionId;
        break;
      }
    }

    if (chosenPositionId === null) {
      consecutiveNoEligible++;
      if (consecutiveNoEligible >= 5) {
        stoppedReason = 'no_eligible';
        detail = `5 consecutive members with no eligible position starting at member ${currentBidder}`;
        break;
      }
      // Advance to the next member and try again
      currentBidder = memberIdToNextMember.get(currentBidder) ?? null;
      continue;
    }
    consecutiveNoEligible = 0;

    // Insert the bid row (proxy bid by admin). ordinal is best-effort — the
    // DO is the source of truth for the live ordering, but rehearsal mode
    // wires straight to D1 so the dashboard shows progress.
    const bidId = ulid();
    const maxOrdRow = await db
      .select({ m: sql<number | null>`max(${bids.ordinal})` })
      .from(bids)
      .where(eq(bids.bidSessionId, sessionId))
      .get();
    const ordinal = (maxOrdRow?.m ?? 0) + 1;
    const idemKey = `rehearsal-auto:${sessionId}:${currentBidder}:${chosenPositionId}:${Date.now()}`;

    await db.insert(bids).values({
      id: bidId,
      bidSessionId: sessionId,
      ordinal,
      memberId: currentBidder,
      positionId: chosenPositionId,
      pickedAt: new Date(),
      forced: false,
      adminActorId,
      reason: `rehearsal auto-bid (${body.strategy})`,
      idempotencyKey: idemKey,
      portalSyncStatus: 'pending',
      portalSyncAttempts: 0,
    });

    await writeAuditLog(db, {
      bidSessionId: sessionId,
      actorType: 'admin',
      actorId: adminActorId,
      action: 'admin_bid_for_member',
      targetKind: 'bid',
      targetId: bidId,
      reason: `rehearsal auto-bid (${body.strategy})`,
      afterState: {
        member_id: currentBidder,
        position_id: chosenPositionId,
        strategy: body.strategy,
        rehearsal: true,
      },
    });

    picksMade++;

    // Advance to the next bidder for the next iteration.
    currentBidder = memberIdToNextMember.get(currentBidder) ?? null;
    await db
      .update(bidSessions)
      .set({ currentBidderId: currentBidder })
      .where(eq(bidSessions.id, sessionId));

    if (currentBidder === null) {
      // Roster exhausted — mark complete and stop.
      await db
        .update(bidSessions)
        .set({ currentPhase: 'complete' })
        .where(eq(bidSessions.id, sessionId));
      stoppedReason = 'complete';
      break;
    }

    // Rate limit between picks. Tests pass through (sleep is short).
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  const responseBody: {
    picksMade: number;
    stoppedReason: string;
    detail?: string;
    bootstrapped?: boolean;
  } = {
    picksMade,
    stoppedReason,
  };
  if (detail !== undefined) responseBody.detail = detail;
  if (bootstrapped) responseBody.bootstrapped = true;
  const status = stoppedReason === 'no_eligible' && picksMade > 0 ? 207 : 200;
  return c.json(responseBody, status);
});

// ── Task R6 — Rehearsal findings (in-app bug tracker) ───────────────────────

const PostFindingBodySchema = z.object({
  bidSessionId: z.string().min(1),
  note: z.string().min(1).max(4000),
  screenshotR2Key: z.string().min(1).max(500).optional(),
});

/**
 * POST /api/admin/rehearsal/findings
 *
 * Body: { bidSessionId, note, screenshotR2Key? }
 *
 * Inserts one finding row. Returns 404 if the session doesn't exist, 201 on
 * success with the created row. Admin-only.
 */
router.post('/findings', zValidator('json', PostFindingBodySchema), async (c) => {
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const s = await db.select().from(bidSessions).where(eq(bidSessions.id, body.bidSessionId)).get();
  if (s === undefined) return c.json({ error: 'session_not_found' }, 404);

  const claims = c.get('claims');
  const authorId = claims.sub > 0 ? claims.sub : null;
  const id = ulid();
  const createdAt = new Date();

  await db.insert(rehearsalFindings).values({
    id,
    bidSessionId: body.bidSessionId,
    createdAt,
    authorId,
    note: body.note,
    screenshotR2Key: body.screenshotR2Key ?? null,
  });

  return c.json(
    {
      id,
      bidSessionId: body.bidSessionId,
      createdAt: createdAt.toISOString(),
      authorId,
      note: body.note,
      screenshotR2Key: body.screenshotR2Key ?? null,
    },
    201,
  );
});

/**
 * GET /api/admin/rehearsal/findings?session_id=…&limit=50
 *
 * Returns findings for one session ordered newest-first. Admin-only.
 */
router.get('/findings', async (c) => {
  const sessionId = c.req.query('session_id');
  if (sessionId === undefined || sessionId === '') {
    return c.json({ error: 'session_id_required' }, 400);
  }
  const limitParam = c.req.query('limit');
  const parsedLimit = limitParam !== undefined ? Number.parseInt(limitParam, 10) : 50;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(rehearsalFindings)
    .where(eq(rehearsalFindings.bidSessionId, sessionId))
    .orderBy(desc(rehearsalFindings.createdAt))
    .limit(limit)
    .all();

  return c.json({
    findings: rows.map((r) => ({
      id: r.id,
      bidSessionId: r.bidSessionId,
      createdAt: r.createdAt.toISOString(),
      authorId: r.authorId,
      note: r.note,
      screenshotR2Key: r.screenshotR2Key,
    })),
  });
});

/**
 * GET /api/admin/rehearsal/findings-recent?limit=50
 *
 * Returns the most recent findings across ALL mock sessions, for the
 * rehearsal dashboard. Admin-only.
 */
router.get('/findings-recent', async (c) => {
  const limitParam = c.req.query('limit');
  const parsedLimit = limitParam !== undefined ? Number.parseInt(limitParam, 10) : 50;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(rehearsalFindings)
    .orderBy(desc(rehearsalFindings.createdAt))
    .limit(limit)
    .all();
  return c.json({
    findings: rows.map((r) => ({
      id: r.id,
      bidSessionId: r.bidSessionId,
      createdAt: r.createdAt.toISOString(),
      authorId: r.authorId,
      note: r.note,
      screenshotR2Key: r.screenshotR2Key,
    })),
  });
});

/**
 * GET /api/admin/rehearsal/sessions
 *
 * Returns the list of mock sessions for the rehearsal dashboard, with
 * minimal columns: id, bid_year, current_phase, current_bidder_id and the
 * timestamp of the most recent bid. Admin-only.
 */
router.get('/sessions', async (c) => {
  const db = getDb(c.env.DB);
  const sessions = await db
    .select({
      id: bidSessions.id,
      bidYear: bidSessions.bidYear,
      currentPhase: bidSessions.currentPhase,
      currentBidderId: bidSessions.currentBidderId,
      isMock: bidSessions.isMock,
    })
    .from(bidSessions)
    .where(eq(bidSessions.isMock, true))
    .all();

  // Last-pick lookup per session (best-effort).
  const lastPicks = new Map<string, string>();
  for (const s of sessions) {
    const last = await db
      .select({ pickedAt: bids.pickedAt })
      .from(bids)
      .where(eq(bids.bidSessionId, s.id))
      .orderBy(desc(bids.pickedAt))
      .limit(1)
      .get();
    if (last !== undefined) {
      lastPicks.set(s.id, last.pickedAt.toISOString());
    }
  }

  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      bidYear: s.bidYear,
      currentPhase: s.currentPhase,
      currentBidderId: s.currentBidderId,
      isMock: s.isMock,
      lastPickedAtIso: lastPicks.get(s.id) ?? null,
    })),
  });
});

export default router;
