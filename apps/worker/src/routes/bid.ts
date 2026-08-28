import {
  type ADayState,
  COMBAT_GROUPS,
  type Member,
  WEEKDAYS,
  canPick,
  computeAllMeters,
} from '@mbfd/a-day';
import { evaluateEligibility } from '@mbfd/eligibility';
import { SubmitADayPickRequestSchema } from '@mbfd/shared';
import { desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import { bidSessions as bidSessionsTable, bids as bidsTable } from '../db/schema.js';
import { hydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState, PersistedADayState } from '../durable/bid-session-state.js';
import { computeBidOrder } from '../lib/bid-order.js';
import {
  bidOrderInputFromSnapshot,
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadFrozenSessionBidPolicy,
} from '../lib/bid-policy.js';
import { mergeFills, resolveCurrentBidderId, resolvePhase } from '../lib/board-merge.js';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import { computeOnDeck } from '../lib/on-deck.js';
import type { WorkerEnv } from '../types/env.js';

type BidContext = Context<{ Bindings: WorkerEnv }>;

const bid = new Hono<{ Bindings: WorkerEnv }>();

async function requireJwt(c: BidContext) {
  const env = validateEnv(c.env);
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return await verifyJwt(auth.slice(7), env.JWT_SIGNING_KEY);
  } catch {
    return null;
  }
}

function readSessionQuery(c: BidContext): string | undefined {
  return c.req.query('bidSessionId') ?? c.req.query('session') ?? c.req.query('session_id');
}

async function resolveBidSessionId(
  c: BidContext,
  explicitSessionId: string | undefined,
): Promise<string | null> {
  if (explicitSessionId && explicitSessionId.trim().length > 0) return explicitSessionId;
  const db = getDb(c.env.DB);
  const sessions = await db
    .select({ id: bidSessionsTable.id, currentPhase: bidSessionsTable.currentPhase })
    .from(bidSessionsTable)
    .orderBy(desc(bidSessionsTable.startedAt))
    .all();
  for (const session of sessions) {
    const canonical = await loadCanonicalBidSessionState(c.env.DB, session.id);
    if ((canonical?.currentPhase ?? session.currentPhase) !== 'complete') return session.id;
  }
  return null;
}

function orderMatchesFrozenSnapshot(
  persisted: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
  expected: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
): boolean {
  return (
    persisted.length === expected.length &&
    persisted.every((entry, index) => {
      const candidate = expected[index];
      return (
        candidate !== undefined &&
        entry.ordinal === candidate.ordinal &&
        entry.memberId === candidate.memberId &&
        entry.pool === candidate.pool
      );
    })
  );
}

bid.get('/me', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  return c.json({
    memberId: claims.sub,
    employeeId: claims.emp,
    role: claims.role,
    rank: claims.rank,
    firstName: claims.first_name,
    lastName: claims.last_name,
  });
});

bid.get('/me/eligibility', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const db = getDb(c.env.DB);
  let sessionId: string | null;
  try {
    sessionId = await resolveBidSessionId(c, readSessionQuery(c));
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }
  if (!sessionId) return c.json({ error: 'no_active_session' }, 404);
  const session = await db
    .select({ id: bidSessionsTable.id, bidYear: bidSessionsTable.bidYear })
    .from(bidSessionsTable)
    .where(eq(bidSessionsTable.id, sessionId))
    .get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);

  let canonicalState: BidSessionState | null;
  try {
    canonicalState = await loadCanonicalBidSessionState(c.env.DB, sessionId);
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }

  // Session pool membership and the associated policy version are frozen at
  // creation. Never fall back to the mutable active rule book here.
  const frozenPolicy = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozenPolicy.ok) {
    return c.json(
      { error: 'session_policy_snapshot_unavailable', policy_error: frozenPolicy.code },
      409,
    );
  }
  const frozenMember = frozenPolicy.snapshot.members.find((entry) => entry.memberId === claims.sub);
  if (frozenMember === undefined) {
    return c.json({ error: 'member_not_in_session_policy_snapshot' }, 403);
  }
  const version = frozenPolicy.snapshot.ruleBookVersion;
  const requestedVersion = c.req.query('rule_book_version');
  if (requestedVersion !== undefined && requestedVersion !== version) {
    return c.json(
      {
        error: 'rule_book_version_not_active',
        requested_version: requestedVersion,
        active_version: version,
      },
      409,
    );
  }
  if (frozenMember.pool === 'EXCLUDED') {
    return c.json({
      memberId: claims.sub,
      excluded_from_bid_pool: true,
      exclusion_reason: frozenMember.exclusionReason,
      rule_book_version: version,
      positions: [],
    });
  }

  const filled = new Set<string>();
  if (canonicalState !== null) {
    for (const positionId of Object.keys(canonicalState.fills)) filled.add(positionId);
  } else {
    const rows = await db
      .select({ positionId: bidsTable.positionId })
      .from(bidsTable)
      .where(eq(bidsTable.bidSessionId, sessionId))
      .all();
    for (const row of rows) filled.add(row.positionId);
  }

  const eligibilityMember = frozenEligibilityMemberForSession(frozenPolicy.snapshot, claims.sub);
  if (eligibilityMember === null) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }

  const positions: Array<{
    positionId: string;
    eligible: boolean;
    reasons: ReturnType<typeof evaluateEligibility>['reasons'];
    points: number;
  }> = [];
  for (const rule of frozenPolicy.coverage.rules) {
    if (filled.has(rule.positionId)) continue;
    const result = evaluateEligibility(eligibilityMemberFromFrozen(eligibilityMember), rule);
    positions.push({
      positionId: rule.positionId,
      eligible: result.eligible,
      reasons: result.reasons,
      points: result.points,
    });
  }

  return c.json({
    memberId: claims.sub,
    rule_book_version: version,
    position_template_version: frozenPolicy.snapshot.positionTemplateVersion,
    positions,
  });
});

interface BidderContext {
  memberId: number;
  ordinal: number;
  pool: 'OFC' | 'FF';
  firstName: string;
  lastName: string;
  rank: string;
  employeeId: string;
}

bid.get('/board', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  let bidSessionId: string | null;
  try {
    bidSessionId = await resolveBidSessionId(c, readSessionQuery(c));
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }
  if (!bidSessionId) return c.json({ error: 'no_active_session' }, 404);
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  const body = (await snap.json()) as Record<string, unknown> & {
    bidOrder?: ReadonlyArray<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }>;
    currentBidderId?: number | null;
    fills?: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  };

  // Plan 09 / Rehearsal Tooling — surface `is_mock` so the page can render
  // MockBanner without a second round-trip. Failure to read the session row
  // (e.g. local dev without seeded data) leaves `is_mock=false` — the live
  // banner only appears when the column explicitly says so.
  // Also ships `sessionStartedAt` so the admin command bar can compute the
  // session-uptime clock without a separate fetch.
  //
  // Additionally pulls `currentPhase` and `currentBidderId` from D1 so we can
  // override the DO snapshot when admin endpoints (rehearsal auto-bid, manual
  // bid-for-member, force-pick) have committed picks directly to D1 without
  // round-tripping through the DO. The DO's in-memory state stays cold in
  // those scenarios, leaving phase='config' / currentBidderId=null forever.
  // D1 is the durable source of truth; the DO is a session-scoped buffer.
  let isMock = false;
  let sessionStartedAt: number | null = null;
  let d1Phase: string | null = null;
  let d1CurrentBidderId: number | null = null;
  let canonicalState: BidSessionState | null = null;
  try {
    const db = getDb(c.env.DB);
    const session = await db
      .select({
        isMock: bidSessionsTable.isMock,
        startedAt: bidSessionsTable.startedAt,
        currentPhase: bidSessionsTable.currentPhase,
        currentBidderId: bidSessionsTable.currentBidderId,
      })
      .from(bidSessionsTable)
      .where(eq(bidSessionsTable.id, bidSessionId))
      .get();
    isMock = session?.isMock === true;
    if (session?.startedAt instanceof Date) {
      sessionStartedAt = session.startedAt.getTime();
    }
    d1Phase = session?.currentPhase ?? null;
    d1CurrentBidderId = session?.currentBidderId ?? null;
  } catch {
    // Best-effort legacy enrichment remains available when D1 is unavailable.
  }

  try {
    canonicalState = await loadCanonicalBidSessionState(c.env.DB, bidSessionId);
  } catch {
    // Once canonical authority is introduced, serving an unverified legacy
    // projection would be misleading. Refuse the board response until D1 can
    // provide or rule out that state.
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }

  if (canonicalState !== null) {
    // The canonical row is the only authority after a mock command commits.
    // Do not overlay stale bid_sessions fields or a cold DO snapshot on top
    // of its paused/frozen state.
    body.currentPhase = canonicalState.currentPhase;
    body.currentBidderId = canonicalState.currentBidderId;
    body.turnStartedAtMs = canonicalState.turnStartedAtMs;
    body.turnTimerSeconds = canonicalState.turnTimerSeconds;
    body.lastSeq = canonicalState.lastSeq;
    body.fills = { ...canonicalState.fills };
    body.bidOrder = [...canonicalState.bidOrder];
    body.queueCursor = canonicalState.queueCursor;
    body.frozenAt = canonicalState.frozenAt;
    body.aDay = canonicalState.aDay;
  }

  // Merge D1-committed bids into the fills map. Auto-bid / admin bid-for-
  // member / force-pick all commit straight to D1; the DO never sees them.
  // Without this merge, /admin/bid renders "all WAITING" even though the
  // rehearsal console reports picks made.
  try {
    const db = getDb(c.env.DB);
    const dbBidRows = await db
      .select({
        id: bidsTable.id,
        memberId: bidsTable.memberId,
        positionId: bidsTable.positionId,
        ordinal: bidsTable.ordinal,
      })
      .from(bidsTable)
      .where(eq(bidsTable.bidSessionId, bidSessionId))
      .all();
    body.fills = mergeFills(body.fills, dbBidRows);
  } catch (err) {
    console.error('[bid.board] D1 fills merge failed (fail-soft)', err);
  }

  if (canonicalState === null) {
    body.currentPhase = resolvePhase(body.currentPhase, d1Phase);
    body.currentBidderId = resolveCurrentBidderId(body.currentBidderId, d1CurrentBidderId);
  }

  // The durable state and direct-D1 rehearsal paths may both surface an
  // order/fill projection. Validate every element against the session's
  // frozen policy before enriching it for the board: an old global-roster
  // order or a Division Chief fill must never be rendered as ordinary Bid.
  const db = getDb(c.env.DB);
  let frozenBoardPolicy: Awaited<ReturnType<typeof loadFrozenSessionBidPolicy>>;
  try {
    frozenBoardPolicy = await loadFrozenSessionBidPolicy(db, bidSessionId);
  } catch {
    return c.json({ error: 'session_policy_snapshot_unavailable' }, 503);
  }
  if (!frozenBoardPolicy.ok) {
    return c.json(
      { error: 'session_policy_snapshot_unavailable', policy_error: frozenBoardPolicy.code },
      409,
    );
  }
  const frozenOrder = computeBidOrder(bidOrderInputFromSnapshot(frozenBoardPolicy.snapshot));
  const frozenMemberIds = new Set(
    frozenBoardPolicy.snapshot.members
      .filter((member) => member.pool !== 'EXCLUDED')
      .map((member) => member.memberId),
  );
  const biddablePositionIds = new Set(
    frozenBoardPolicy.coverage.rules.map((rule) => rule.positionId),
  );
  const bodyOrder = Array.isArray(body.bidOrder) ? body.bidOrder : [];
  if (bodyOrder.length > 0 && !orderMatchesFrozenSnapshot(bodyOrder, frozenOrder)) {
    return c.json({ error: 'bid_order_not_frozen_policy' }, 409);
  }
  const boardFills = body.fills && typeof body.fills === 'object' ? body.fills : {};
  for (const [positionId, fill] of Object.entries(boardFills)) {
    if (!biddablePositionIds.has(positionId) || !frozenMemberIds.has(fill.memberId)) {
      return c.json({ error: 'bid_state_not_frozen_policy' }, 409);
    }
  }
  if (typeof body.currentBidderId === 'number' && !frozenMemberIds.has(body.currentBidderId)) {
    return c.json({ error: 'bid_state_not_frozen_policy' }, 409);
  }

  // Live Bid Console enrichment derives its display map from the same immutable
  // snapshot as the bidding mechanics. The snapshot deliberately does not
  // retain directory PII, so historical views use a stable Member #id label
  // and frozen rank rather than looking up today's roster.
  let currentBidder: BidderContext | null = null;
  let onDeck: BidderContext[] = [];
  const members: Record<
    string,
    {
      id: number;
      firstName: string;
      lastName: string;
      rank: string;
      employeeId: string;
      priorPositionId: string | null;
    }
  > = {};
  // When a brand-new session is in `config` phase, the DO projection has no
  // materialized order yet. Preview only the order derived from its frozen
  // policy snapshot; do not substitute the mutable global roster.
  let bidOrder: ReadonlyArray<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }> =
    bodyOrder;
  let bidOrderPreview = false;
  if (bidOrder.length === 0 && frozenOrder.length > 0) {
    bidOrder = frozenOrder;
    bidOrderPreview = true;
  }

  const currentBidderId = typeof body.currentBidderId === 'number' ? body.currentBidderId : null;
  const fillsRec = body.fills && typeof body.fills === 'object' ? body.fills : {};
  const filledMemberIds = new Set<number>(Object.values(fillsRec).map((f) => f.memberId));
  const onDeckEntries = computeOnDeck(bidOrder, currentBidderId, filledMemberIds);
  const snapshotMembersById = new Map(
    frozenBoardPolicy.snapshot.members.map((member) => [member.memberId, member]),
  );
  const bidOrderIndex = new Map(bidOrder.map((entry) => [entry.memberId, entry]));
  const lookupIds = new Set<number>();
  for (const entry of bidOrder) lookupIds.add(entry.memberId);
  for (const memberId of filledMemberIds) lookupIds.add(memberId);
  if (currentBidderId !== null) lookupIds.add(currentBidderId);
  for (const entry of onDeckEntries) lookupIds.add(entry.memberId);

  for (const memberId of lookupIds) {
    const member = snapshotMembersById.get(memberId);
    if (member === undefined) continue;
    members[String(memberId)] = {
      id: memberId,
      firstName: 'Member',
      lastName: `#${memberId}`,
      rank: member.rank,
      employeeId: `#${memberId}`,
      priorPositionId: null,
    };
  }
  if (currentBidderId !== null) {
    const member = snapshotMembersById.get(currentBidderId);
    const order = bidOrderIndex.get(currentBidderId);
    if (member !== undefined && order !== undefined) {
      currentBidder = {
        memberId: member.memberId,
        ordinal: order.ordinal,
        pool: order.pool,
        firstName: 'Member',
        lastName: `#${member.memberId}`,
        rank: member.rank,
        employeeId: `#${member.memberId}`,
      };
    }
  }
  onDeck = onDeckEntries.flatMap((entry) => {
    const member = snapshotMembersById.get(entry.memberId);
    if (member === undefined) return [];
    return [
      {
        memberId: member.memberId,
        ordinal: entry.ordinal,
        pool: entry.pool,
        firstName: 'Member',
        lastName: `#${member.memberId}`,
        rank: member.rank,
        employeeId: `#${member.memberId}`,
      },
    ];
  });

  return c.json({
    ...body,
    isMock,
    bidSessionId,
    sessionStartedAt,
    bidOrder,
    bidOrderPreview,
    currentBidder,
    onDeck,
    members,
    positions: frozenBoardPolicy.snapshot.ruleBookMaterial.positions,
  });
});

bid.get('/bid/state', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const sinceSeq = Number(c.req.query('since_seq') ?? '0');
  let bidSessionId: string | null;
  try {
    bidSessionId = await resolveBidSessionId(c, readSessionQuery(c));
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }
  if (!bidSessionId) return c.json({ error: 'no_active_session' }, 404);
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  const state = (await snap.json()) as { lastSeq: number };
  return c.json({ seq: state.lastSeq, since: sinceSeq, events: [], state });
});

// ---------- Plan 07 Phase 2 (A-Day) REST routes ----------

/**
 * A-Day capacity/order checks require rank and seniority. Fresh sessions read
 * them only from their V3 frozen member projection, never from the mutable
 * current roster after a mock or live session has been created.
 */
async function loadFrozenMembersForADay(
  c: BidContext,
  bidSessionId: string,
): Promise<Member[] | null> {
  const policy = await loadFrozenSessionBidPolicy(getDb(c.env.DB), bidSessionId);
  if (!policy.ok || policy.snapshot.v !== 3) return null;
  return policy.snapshot.members.map(
    (member): Member => ({
      ...eligibilityMemberFromFrozen(member),
      employeeId: String(member.memberId),
    }),
  );
}

async function fetchSessionSnapshot(
  c: BidContext,
  bidSessionId: string,
): Promise<BidSessionState | null> {
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  if (!snap.ok) return null;
  return (await snap.json()) as BidSessionState;
}

/**
 * GET /api/bid/a-day-state?session=:id
 * Returns the snapshot needed to render the Phase 2 picker:
 *  - current phase
 *  - whether it is the calling member's turn
 *  - eligible A-Day candidates for that member (subject to canPick)
 *  - capacity meters for all 12 groups + 7 weekdays
 */
bid.get('/bid/a-day-state', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const sessionId = c.req.query('session');
  if (!sessionId) return c.json({ error: 'session_required' }, 400);

  const snapshot = await fetchSessionSnapshot(c, sessionId);
  if (!snapshot) return c.json({ error: 'session_not_found' }, 404);

  if (snapshot.currentPhase !== 'a_day_bid' || !snapshot.aDay) {
    return c.json({
      currentPhase: snapshot.currentPhase,
      isMyTurn: false,
      shift: null,
      eligibleADays: [],
      meters: { groups: [], weekdays: [] },
    });
  }

  const memberId = Number(claims.sub);
  const members = await loadFrozenMembersForADay(c, sessionId);
  if (members === null) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }
  const membersById = new Map<number, Member>(members.map((m) => [Number(m.employeeId), m]));
  const aDayState: ADayState = hydrateADayState(snapshot.aDay, membersById);
  const phase1 = aDayState.phase1ByMember.get(memberId);
  const isMyTurn = snapshot.currentBidderId === memberId;
  const candidates: readonly string[] = phase1?.shift === 'D' ? WEEKDAYS : COMBAT_GROUPS;
  const eligibleADays = candidates.filter((aDay) => canPick(aDayState, memberId, aDay as never).ok);
  return c.json({
    currentPhase: snapshot.currentPhase,
    isMyTurn,
    shift: phase1?.shift ?? null,
    eligibleADays,
    meters: computeAllMeters(aDayState),
  });
});

/**
 * POST /api/bid/a-day-pick
 * REST fallback for non-WS clients. Forwards to the DO's submitADayPick handler.
 */
bid.post('/bid/a-day-pick', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const raw = await c.req.json().catch(() => null);
  const parsed = SubmitADayPickRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400);
  }
  const memberId = Number(claims.sub);
  const snapshot = await fetchSessionSnapshot(c, parsed.data.bidSessionId);
  if (!snapshot) return c.json({ error: 'session_not_found' }, 404);
  if (snapshot.currentPhase !== 'a_day_bid' || !snapshot.aDay) {
    return c.json(
      {
        type: 'a_day_reject',
        v: 1,
        memberId,
        reasonCode: 'PHASE_NOT_A_DAY_BID',
        reasonLabel: `Phase 2 is not active (phase=${snapshot.currentPhase}).`,
      },
      403,
    );
  }
  if (snapshot.currentBidderId !== memberId) {
    return c.json(
      {
        type: 'a_day_reject',
        v: 1,
        memberId,
        reasonCode: 'NOT_YOUR_TURN',
        reasonLabel: 'It is not your turn to pick.',
      },
      403,
    );
  }

  const members = await loadFrozenMembersForADay(c, parsed.data.bidSessionId);
  if (members === null) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }
  const doId = c.env.BID_SESSION.idFromName(parsed.data.bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const doResp = await stub.fetch(`${new URL(c.req.url).origin}/submit-a-day-pick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      senderMemberId: memberId,
      aDay: parsed.data.aDay,
      idempotencyKey: parsed.data.idempotencyKey,
      members,
    }),
  });
  const json = (await doResp.json()) as { kind: string; code?: string };
  if (json.kind === 'rejected') {
    if (json.code === 'NOT_YOUR_TURN' || json.code === 'PHASE_NOT_A_DAY_BID') {
      return c.json(json, 403);
    }
    return c.json(json, 409);
  }
  return c.json(json, 200);
});

// Re-export the inferred persisted shape for tests.
export type { BidSessionState, PersistedADayState };

export default bid;
