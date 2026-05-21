import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  bidOrder as bidOrderTable,
  bidSessions,
  bids as bidsTable,
  members,
} from '../db/schema.js';
import { chunkedInArraySelect } from '../lib/d1-batch.js';
import type { WorkerEnv } from '../types/env.js';
import type { EligibilityMatrixRow, RosterInput, RosterMember } from './prompts/user-roster.js';
import type { TurnInput } from './prompts/user-turn.js';

export async function loadRosterForSession(
  env: WorkerEnv,
  bidSessionId: string,
): Promise<RosterInput> {
  const db = getDb(env.DB);
  const rows = await db.select().from(members).all();
  const rosterMembers: RosterMember[] = rows.map((m) => ({
    employeeId: m.employeeId,
    firstName: m.firstName,
    lastName: m.lastName,
    rank: m.rank,
    bidCategory: m.bidCategory,
    rscSeniority: m.rscSeniority,
    rankSeniority: m.rankSeniority,
    isProbationary: m.isProbationary,
    credentials: [], // populated via a second join in real impl
    priorYearBid: m.priorPositionId ?? null,
  }));
  // Eligibility matrix: pull from KV snapshot per spec §6.2
  const snap = await env.KV.get(`eligibility_snapshot:${bidSessionId}`);
  const eligibilityMatrix: EligibilityMatrixRow[] = snap
    ? (JSON.parse(snap) as EligibilityMatrixRow[])
    : [];
  return { bidSessionId, members: rosterMembers, eligibilityMatrix };
}

/**
 * Load the live turn state for the AI advisor — phase, current bidder, the
 * next 20 in the queue, position fills committed so far, and the remaining
 * unfilled positions.
 *
 * Reads from D1 directly (the DO buffers in-flight picks but D1 is the
 * durable source of truth, and several admin codepaths — auto-bid, manual-
 * pick, bid-for-member, force-pick — write straight to D1). Without this
 * the AI receives `currentBidderEmployeeId: null` even after picks have
 * been made and replies "No current bidder to advise on pick."
 */
export async function loadTurnStateForSession(
  env: WorkerEnv,
  bidSessionId: string,
): Promise<Omit<TurnInput, 'question'>> {
  const db = getDb(env.DB);

  const session = await db
    .select({
      currentPhase: bidSessions.currentPhase,
      currentBidderId: bidSessions.currentBidderId,
    })
    .from(bidSessions)
    .where(eq(bidSessions.id, bidSessionId))
    .get();

  // bid_sessions uses ('a_day_bid', 'complete'); the AI prompt schema uses
  // ('a_day_phase', 'completed'). Translate so the AI gets the names it
  // expects.
  const phase: TurnInput['phase'] = (() => {
    switch (session?.currentPhase) {
      case 'config':
        return 'config';
      case 'position_bid':
        return 'position_bid';
      case 'a_day_bid':
        return 'a_day_phase';
      case 'paused':
        return 'paused';
      case 'complete':
        return 'completed';
      default:
        return 'position_bid';
    }
  })();

  // Look up the current bidder's employee_id so the AI prompt can reference
  // the member by their canonical identifier (not the internal int).
  let currentBidderEmployeeId: string | null = null;
  if (session?.currentBidderId !== null && session?.currentBidderId !== undefined) {
    const m = await db
      .select({ employeeId: members.employeeId })
      .from(members)
      .where(eq(members.id, session.currentBidderId))
      .get();
    currentBidderEmployeeId = m?.employeeId ?? null;
  }

  // Build the queue: next 20 bidders in ordinal order, skipping anyone who
  // already has a fill (they've already taken their turn). 20 is enough for
  // the AI to reason about who's still coming without bloating the prompt.
  const orderRows = await db
    .select({
      ordinal: bidOrderTable.ordinal,
      memberId: bidOrderTable.memberId,
    })
    .from(bidOrderTable)
    .where(eq(bidOrderTable.bidSessionId, bidSessionId))
    .orderBy(asc(bidOrderTable.ordinal))
    .all();

  const bidRows = await db
    .select({ memberId: bidsTable.memberId, positionId: bidsTable.positionId })
    .from(bidsTable)
    .where(eq(bidsTable.bidSessionId, bidSessionId))
    .all();

  const pickedMemberIds = new Set<number>(bidRows.map((b) => b.memberId));
  const positionFills: Record<string, string> = {};
  // Map memberId → employeeId so we can render fills using the canonical id.
  const memberIdsToLookUp = new Set<number>();
  for (const b of bidRows) memberIdsToLookUp.add(b.memberId);
  for (const e of orderRows) {
    if (!pickedMemberIds.has(e.memberId)) memberIdsToLookUp.add(e.memberId);
  }
  // Fetch employee_ids for everyone we care about. Chunked to stay under
  // D1's ~100-placeholder cap for IN(...) lookups.
  const memberLookup = new Map<number, string>();
  if (memberIdsToLookUp.size > 0) {
    const rows = await chunkedInArraySelect(Array.from(memberIdsToLookUp), (chunk) =>
      db
        .select({ id: members.id, employeeId: members.employeeId })
        .from(members)
        .where(inArray(members.id, chunk))
        .all(),
    );
    for (const r of rows) memberLookup.set(r.id, r.employeeId);
  }

  for (const b of bidRows) {
    const emp = memberLookup.get(b.memberId);
    if (emp !== undefined) positionFills[b.positionId] = emp;
  }

  const queue: string[] = [];
  for (const e of orderRows) {
    if (pickedMemberIds.has(e.memberId)) continue;
    const emp = memberLookup.get(e.memberId);
    if (emp !== undefined) queue.push(emp);
    if (queue.length >= 20) break;
  }

  // Remaining positions: every position id in the schema not yet filled. We
  // don't ship the full positions list here — leave it to the route layer
  // when it knows the active rule book. For the prompt, an empty list is
  // acceptable when we can't enumerate cheaply; the AI works off the roster
  // + eligibility matrix anyway.
  const remainingPositionIds: string[] = [];

  return {
    phase,
    currentBidderEmployeeId,
    queue,
    positionFills,
    remainingPositionIds,
  };
}
