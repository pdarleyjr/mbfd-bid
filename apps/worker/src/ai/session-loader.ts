import { getDb } from '../db/index.js';
import { members } from '../db/schema.js';
import type { WorkerEnv } from '../types/env.js';
import type {
  EligibilityMatrixRow,
  RosterInput,
  RosterMember,
} from './prompts/user-roster.js';
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
    priorYearBid: null,
  }));
  // Eligibility matrix: pull from KV snapshot per spec §6.2
  const snap = await env.KV.get(`eligibility_snapshot:${bidSessionId}`);
  const eligibilityMatrix: EligibilityMatrixRow[] = snap
    ? (JSON.parse(snap) as EligibilityMatrixRow[])
    : [];
  return { bidSessionId, members: rosterMembers, eligibilityMatrix };
}

export async function loadTurnStateForSession(
  _env: WorkerEnv,
  _bidSessionId: string,
): Promise<Omit<TurnInput, 'question'>> {
  // Read the DO-shadowed bid_sessions row + position_fills snapshot from D1.
  // For the initial wire-up, return a placeholder shape and let Plan 04/05
  // integration tests cover the real path.
  return {
    phase: 'position_bid',
    currentBidderEmployeeId: null,
    queue: [],
    positionFills: {},
    remainingPositionIds: [],
  };
}
