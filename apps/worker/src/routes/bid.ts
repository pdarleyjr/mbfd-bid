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
import { and, desc, eq, inArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import {
  bidSessions as bidSessionsTable,
  bids as bidsTable,
  credentials,
  memberCredentials,
  members as membersTable,
  positionRules,
  ruleBooks,
} from '../db/schema.js';
import { hydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState, PersistedADayState } from '../durable/bid-session-state.js';
import { computeBidOrder } from '../lib/bid-order.js';
import { mergeFills, resolveCurrentBidderId, resolvePhase } from '../lib/board-merge.js';
import { chunkedInArraySelect } from '../lib/d1-batch.js';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import { computeOnDeck } from '../lib/on-deck.js';
import { decodeRuleBookRows } from '../lib/position-rule.js';
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
  const member = await db.select().from(membersTable).where(eq(membersTable.id, claims.sub)).get();
  if (member === undefined) return c.json({ error: 'member_not_found' }, 404);

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

  // A member route must not evaluate an arbitrary draft or archived policy.
  // Bind it to the one active book for the selected session's bid year.
  const activeRuleBooks = await db
    .select({ version: ruleBooks.version })
    .from(ruleBooks)
    .where(and(eq(ruleBooks.status, 'active'), eq(ruleBooks.effectiveYear, session.bidYear)))
    .all();
  if (activeRuleBooks.length === 0) return c.json({ error: 'no_active_rule_book' }, 404);
  if (activeRuleBooks.length !== 1) return c.json({ error: 'active_rule_book_ambiguous' }, 409);
  const activeRuleBook = activeRuleBooks.at(0);
  if (activeRuleBook === undefined) return c.json({ error: 'no_active_rule_book' }, 404);
  const version = activeRuleBook.version;
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

  const memberCreds = await db
    .select({ name: credentials.name })
    .from(memberCredentials)
    .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
    .where(eq(memberCredentials.memberId, claims.sub))
    .all();

  const rules = await db
    .select()
    .from(positionRules)
    .where(eq(positionRules.ruleBookVersion, version))
    .all();
  const decodedRuleBook = decodeRuleBookRows(rules);
  if (
    rules.length === 0 ||
    decodedRuleBook.invalidPositionIds.length > 0 ||
    decodedRuleBook.duplicatePositionIds.length > 0
  ) {
    return c.json(
      {
        error: 'active_rule_book_invalid',
        invalid_position_ids: decodedRuleBook.invalidPositionIds,
        duplicate_position_ids: decodedRuleBook.duplicatePositionIds,
      },
      409,
    );
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

  const eligibilityMember = {
    employeeId: member.employeeId,
    firstName: member.firstName,
    lastName: member.lastName,
    rank: member.rank,
    rscSeniority: member.rscSeniority,
    rankSeniority: member.rankSeniority ?? undefined,
    isProbationary: member.isProbationary,
    credentials: memberCreds.map((cred) => ({ name: cred.name })),
  };

  const positions: Array<{
    positionId: string;
    eligible: boolean;
    reasons: ReturnType<typeof evaluateEligibility>['reasons'];
    points: number;
  }> = [];
  for (const rule of decodedRuleBook.rules) {
    if (filled.has(rule.positionId)) continue;
    const result = evaluateEligibility(eligibilityMember, rule);
    positions.push({
      positionId: rule.positionId,
      eligible: result.eligible,
      reasons: result.reasons,
      points: result.points,
    });
  }

  return c.json({ memberId: claims.sub, positions });
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

  // Live Bid Console enrichment — hydrate the active bidder + next-5 queue
  // with member context so the UI shows "CPT Sola (14335)" instead of just
  // "ID 14335". Best-effort: if D1 lookup fails the legacy id-only payload
  // still ships and the front-end renders the fallback.
  //
  // Also ships a `members` map covering every member id referenced in
  // bidOrder / fills / currentBidder / onDeck so the cell renderer can show
  // "Lt Sola" inside each filled position without further fetches.
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
  // When the session is in `config` phase (or otherwise hasn't materialised
  // its persisted bid_order yet) the DO snapshot ships `bidOrder: []`. That
  // hides the "who's next" queue from the admin console even though we can
  // compute it deterministically from the roster (computeBidOrder applies
  // the same seniority + pool rules the session-start codepath uses).
  // Compute it on-the-fly here as a preview so the dashboard surfaces the
  // upcoming order from the moment the session is created.
  let bidOrder: ReadonlyArray<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }> =
    Array.isArray(body.bidOrder) ? body.bidOrder : [];
  let bidOrderPreview = false;
  try {
    if (bidOrder.length === 0) {
      const db = getDb(c.env.DB);
      const memberRows = await db
        .select({
          id: membersTable.id,
          bidCategory: membersTable.bidCategory,
          rscSeniority: membersTable.rscSeniority,
          rankSeniority: membersTable.rankSeniority,
        })
        .from(membersTable)
        .all();
      const computed = computeBidOrder(memberRows);
      if (computed.length > 0) {
        bidOrder = computed;
        bidOrderPreview = true;
      }
    }
  } catch (err) {
    console.error('[bid.board] bidOrder preview failed (fail-soft)', err);
  }

  try {
    const currentBidderId = typeof body.currentBidderId === 'number' ? body.currentBidderId : null;
    const fillsRec = body.fills && typeof body.fills === 'object' ? body.fills : {};
    const filledMemberIds = new Set<number>(Object.values(fillsRec).map((f) => f.memberId));
    const onDeckEntries = computeOnDeck(bidOrder, currentBidderId, filledMemberIds);

    // Lookup set: everyone in bidOrder ∪ filled ∪ currentBidder ∪ onDeck.
    // Worst case is one row per member in the session (≈226 today). Chunked
    // SELECT keeps the IN(...) under the D1 placeholder cap.
    const lookupIds = new Set<number>();
    for (const e of bidOrder) lookupIds.add(e.memberId);
    for (const id of filledMemberIds) lookupIds.add(id);
    if (currentBidderId !== null) lookupIds.add(currentBidderId);
    for (const e of onDeckEntries) lookupIds.add(e.memberId);

    if (lookupIds.size > 0) {
      const db = getDb(c.env.DB);
      const rows = await chunkedInArraySelect(Array.from(lookupIds), (chunk) =>
        db
          .select({
            id: membersTable.id,
            employeeId: membersTable.employeeId,
            firstName: membersTable.firstName,
            lastName: membersTable.lastName,
            rank: membersTable.rank,
            priorPositionId: membersTable.priorPositionId,
          })
          .from(membersTable)
          .where(inArray(membersTable.id, chunk))
          .all(),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      const bidOrderIndex = new Map(bidOrder.map((e) => [e.memberId, e]));
      if (currentBidderId !== null) {
        const row = byId.get(currentBidderId);
        const order = bidOrderIndex.get(currentBidderId);
        if (row && order) {
          currentBidder = {
            memberId: row.id,
            ordinal: order.ordinal,
            pool: order.pool,
            firstName: row.firstName,
            lastName: row.lastName,
            rank: row.rank,
            employeeId: row.employeeId,
          };
        }
      }
      onDeck = onDeckEntries.flatMap((entry) => {
        const row = byId.get(entry.memberId);
        if (!row) return [];
        return [
          {
            memberId: row.id,
            ordinal: entry.ordinal,
            pool: entry.pool,
            firstName: row.firstName,
            lastName: row.lastName,
            rank: row.rank,
            employeeId: row.employeeId,
          },
        ];
      });
      // Build the members map. Keys are stringified ids so the JSON payload
      // round-trips cleanly (numeric keys would re-serialise as strings
      // anyway under JSON.stringify).
      for (const row of rows) {
        members[String(row.id)] = {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          rank: row.rank,
          employeeId: row.employeeId,
          priorPositionId: row.priorPositionId ?? null,
        };
      }
    }
  } catch (err) {
    console.error('[bid.board] enrichment failed (fail-soft)', err);
  }

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
 * Load the full member roster from D1. The DO state holds A-Day picks but not
 * member rank/name detail, so we hydrate from the database for invariant
 * lookups and meter calculation. Returns Member objects shaped for @mbfd/a-day.
 */
async function loadMembersForADay(c: BidContext): Promise<Member[]> {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(membersTable);
  return rows.map(
    (m): Member => ({
      employeeId: String(m.id),
      firstName: m.firstName,
      lastName: m.lastName,
      rank: m.rank,
      rscSeniority: m.rscSeniority,
      rankSeniority: m.rankSeniority ?? undefined,
      isProbationary: m.isProbationary,
      credentials: [],
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
  const members = await loadMembersForADay(c);
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

  const members = await loadMembersForADay(c);
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
