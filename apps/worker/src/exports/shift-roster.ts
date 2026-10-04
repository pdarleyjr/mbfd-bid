import type { D1Database } from '@cloudflare/workers-types';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { and, eq, ne } from 'drizzle-orm';

import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import { bidSessions, bids } from '../db/schema.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { loadFrozenSessionBidPolicy } from '../lib/bid-policy.js';

export const EXPORT_SHIFTS = ['A', 'B', 'C', 'D'] as const;
export type ExportShift = (typeof EXPORT_SHIFTS)[number];
export type ExportScope = ExportShift | 'ALL';
type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;

export interface ShiftRosterRow {
  positionId: string;
  unit: string;
  position: string;
  rank: string;
  member: string | null;
  memberRank: string | null;
  aDay: string | null;
  status: 'Selected' | 'Available' | 'Not biddable';
  markers: string[];
  temporaryDuties: string[];
}

export interface ShiftRoster {
  sessionId: string;
  year: number;
  isMock: boolean;
  sequence: number;
  phase: string;
  generatedAt: string;
  snapshotCapturedAt: string;
  ruleBookVersion: string;
  configurationRevision: number;
  scope: ExportScope;
  shifts: Array<{
    shift: ExportShift;
    positions: number;
    selected: number;
    available: number;
    stations: Array<{ station: string; rows: ShiftRosterRow[] }>;
  }>;
  unplacedTemporaryDuties: string[];
}

export class ShiftRosterError extends Error {
  constructor(
    readonly code: string,
    readonly status: 404 | 409,
  ) {
    super(code);
  }
}

export function shiftLabel(shift: ExportShift): string {
  return shift === 'D' ? 'Days' : `${shift} Shift`;
}

export function exportTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(new Date(value));
}

export function aDayLabel(value: string): string {
  const labels: Record<string, string> = {
    G1: 'Group 1',
    G2: 'Group 2',
    G3: 'Group 3',
    G4: 'Group 4',
    MON: 'Monday',
    TUE: 'Tuesday',
    WED: 'Wednesday',
    THU: 'Thursday',
    FRI: 'Friday',
    SAT: 'Saturday',
    SUN: 'Sunday',
  };
  return labels[value] ?? value;
}

/** Only immutable operational identity is exported: no employee IDs, contact
 * information, qualifications, notes, or credential evidence are included. */
export function buildShiftRoster(input: {
  sessionId: string;
  year: number;
  isMock: boolean;
  phase: string;
  snapshot: Snapshot;
  validPositionIds: ReadonlySet<string>;
  state: BidSessionState | null;
  legacyAwards: readonly {
    memberId: number;
    positionId: string;
    aDay: string | null;
    forced: boolean;
  }[];
  scope: ExportScope;
  generatedAt: string;
}): ShiftRoster {
  const { snapshot, state } = input;
  const positions = new Map(snapshot.ruleBookMaterial.positions.map((p) => [p.id, p]));
  const members = new Map(snapshot.members.map((m) => [m.memberId, m]));
  const identities = new Map(
    (snapshot.operatorIdentityProjection ?? []).map((m) => [m.memberId, m]),
  );
  const memberLabel = (memberId: number) => {
    const identity = identities.get(memberId);
    return identity
      ? `${identity.firstName} ${identity.lastName}`
      : 'Name unavailable in saved bid';
  };
  const awards = new Map<
    string,
    {
      memberId: number;
      aDay: string | null;
      forced: boolean;
      deferred: boolean;
      aDayOverride: boolean;
    }
  >();
  const sourceAwards = state
    ? Object.entries(state.fills).map(([positionId, fill]) => ({
        positionId,
        memberId: fill.memberId,
        aDay:
          state.aDay?.picks.find((p) => p.memberId === fill.memberId)?.aDay ?? fill.aDay ?? null,
        forced: fill.forced !== undefined,
        deferred: fill.aDayDeferral !== undefined,
        aDayOverride: fill.aDayOverride !== undefined,
      }))
    : input.legacyAwards.map((award) => ({ ...award, deferred: false, aDayOverride: false }));
  const awardedMembers = new Set<number>();
  for (const award of sourceAwards) {
    const position = positions.get(award.positionId);
    const member = members.get(award.memberId);
    if (
      !position ||
      !member ||
      member.pool === 'EXCLUDED' ||
      position.bidParticipation !== 'BIDDABLE' ||
      !input.validPositionIds.has(award.positionId) ||
      awards.has(award.positionId) ||
      awardedMembers.has(award.memberId)
    ) {
      throw new ShiftRosterError('session_bid_reference_invalid', 409);
    }
    awards.set(award.positionId, award);
    awardedMembers.add(award.memberId);
  }
  const duties = new Map<string, string[]>();
  const unplacedTemporaryDuties: string[] = [];
  for (const duty of state?.live?.exceptionalAssignments ?? []) {
    if (duty.releasedAtMs !== null) continue;
    if (
      !members.has(duty.memberId) ||
      (duty.positionId !== null && !positions.has(duty.positionId))
    ) {
      throw new ShiftRosterError('session_temporary_duty_reference_invalid', 409);
    }
    const label = `${memberLabel(duty.memberId)} - ${duty.roleLabel}`;
    if (duty.positionId === null) unplacedTemporaryDuties.push(label);
    else duties.set(duty.positionId, [...(duties.get(duty.positionId) ?? []), label]);
  }
  const selectedShifts = input.scope === 'ALL' ? EXPORT_SHIFTS : [input.scope];
  return {
    sessionId: input.sessionId,
    year: input.year,
    isMock: input.isMock,
    sequence: state?.lastSeq ?? 0,
    phase: state?.currentPhase ?? input.phase,
    generatedAt: input.generatedAt,
    snapshotCapturedAt: new Date(snapshot.capturedAtMs).toISOString(),
    ruleBookVersion: snapshot.ruleBookVersion,
    configurationRevision: snapshot.configurationRevision,
    scope: input.scope,
    shifts: selectedShifts.map((shift) => {
      const stationMap = new Map<string, ShiftRosterRow[]>();
      let selected = 0;
      let available = 0;
      const shiftPositions = snapshot.ruleBookMaterial.positions.filter((p) => p.shift === shift);
      for (const position of shiftPositions) {
        const award = awards.get(position.id);
        const member = award ? members.get(award.memberId) : null;
        const status = award
          ? 'Selected'
          : position.bidParticipation === 'BIDDABLE'
            ? 'Available'
            : 'Not biddable';
        if (award) selected += 1;
        if (status === 'Available') available += 1;
        const row: ShiftRosterRow = {
          positionId: position.id,
          unit: position.unit,
          position: position.positionName,
          rank: position.rankRequired,
          member: award ? memberLabel(award.memberId) : null,
          memberRank: member?.rank ?? null,
          aDay: award
            ? award.aDay === null
              ? award.deferred
                ? 'Deferred'
                : 'Not selected'
              : aDayLabel(award.aDay)
            : null,
          status,
          markers: [
            ...(award?.forced ? ['Forced'] : []),
            ...(award?.aDayOverride ? ['A-Day override'] : []),
          ],
          temporaryDuties: duties.get(position.id) ?? [],
        };
        stationMap.set(position.station, [...(stationMap.get(position.station) ?? []), row]);
      }
      return {
        shift,
        positions: shiftPositions.length,
        selected,
        available,
        stations: [...stationMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
          .map(([station, rows]) => ({
            station,
            rows: rows.sort((a, b) =>
              a.positionId.localeCompare(b.positionId, 'en', { numeric: true }),
            ),
          })),
      };
    }),
    unplacedTemporaryDuties: input.scope === 'ALL' ? unplacedTemporaryDuties : [],
  };
}

/** Read the canonical state exactly once. ALL-shift exports must never combine
 * awards from successive commands or from the presentation's held projection. */
export async function captureShiftRoster(
  database: D1Database,
  sessionId: string,
  scope: ExportScope,
): Promise<ShiftRoster> {
  const db = getDb(database);
  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (!session) throw new ShiftRosterError('session_not_found', 404);
  const frozen = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozen.ok) throw new ShiftRosterError(frozen.code, 409);
  let state: BidSessionState | null;
  try {
    state = await loadCanonicalBidSessionState(database, sessionId);
  } catch {
    throw new ShiftRosterError('canonical_state_invalid', 409);
  }
  const legacyAwards = state
    ? []
    : await db
        .select({
          memberId: bids.memberId,
          positionId: bids.positionId,
          aDay: bids.aDay,
          forced: bids.forced,
        })
        .from(bids)
        // Superseded awards remain history, never a second current assignment.
        .where(and(eq(bids.bidSessionId, sessionId), ne(bids.portalSyncStatus, 'superseded')))
        .all();
  return buildShiftRoster({
    sessionId,
    year: session.bidYear,
    isMock: session.isMock,
    phase: session.currentPhase,
    snapshot: frozen.snapshot,
    validPositionIds: new Set(frozen.coverage.validRulePositionIds),
    state,
    legacyAwards,
    scope,
    generatedAt: new Date().toISOString(),
  });
}
