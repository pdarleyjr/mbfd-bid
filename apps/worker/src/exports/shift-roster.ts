import type { D1Database } from '@cloudflare/workers-types';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { and, eq, ne } from 'drizzle-orm';

import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import { bidSessions, bids } from '../db/schema.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { loadFrozenSessionBidPolicy } from '../lib/bid-policy.js';
import type { CurrentStaffingReceipt } from '../lib/current-staffing-source.js';
import { loadFinalResultSource } from '../lib/final-result-source.js';
import { projectFrozenNonBidAssignments } from '../lib/frozen-nonbid-assignments.js';
import { activeLivePositionIds } from '../lib/live-bid-opportunities.js';

export const EXPORT_SHIFTS = ['A', 'B', 'C', 'D'] as const;
export type ExportShift = (typeof EXPORT_SHIFTS)[number];
export type ExportScope = ExportShift | 'ALL';
type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;

export interface ShiftRosterRow {
  positionId: string;
  unit: string;
  position: string;
  rank: string;
  /** Saved topology facts, never inferred from a member's current directory seat. */
  division?: string;
  isFloating?: boolean;
  isExcludedFromCount?: boolean;
  administrativeAssignment?: boolean;
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
  currentStaffing?: { sourceName: string; sourceSha256: string; snapshotAt: string };
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
  /** Optional verified directory context, used only for Shift View Chief 300 seats. */
  currentStaffing?: CurrentStaffingReceipt | null;
}): ShiftRoster {
  const { snapshot, state } = input;
  const fixedAssignments = projectFrozenNonBidAssignments(snapshot);
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
  const chiefUnit = (value: string | null) =>
    ['300', 'CHIEF300', 'DIVISIONCHIEF300'].includes(
      (value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase(),
    );
  const chiefRole = (value: string | null) =>
    (value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase() === 'DIVISIONCHIEF';
  const stationKey = (value: string | null) =>
    (value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const directory =
    input.currentStaffing &&
    new Date(input.currentStaffing.archive.snapshotAt).getTime() <=
      new Date(input.generatedAt).getTime()
      ? input.currentStaffing.archive
      : null;
  const chiefs = new Map<string, { memberId: number; aDay: string | null }>();
  if (directory) {
    for (const shift of EXPORT_SHIFTS) {
      const seats = snapshot.ruleBookMaterial.positions.filter(
        (position) =>
          position.shift === shift &&
          position.bidParticipation === 'ADMIN_ASSIGNED_NON_BIDDABLE' &&
          position.rankRequired === 'DC' &&
          chiefUnit(position.unit) &&
          chiefRole(position.positionName),
      );
      const staff = directory.rows.filter(
        (row) => row.shift === shift && chiefUnit(row.unit) && chiefRole(row.positionLabel),
      );
      if (seats.length !== 1 || staff.length !== 1) continue;
      const seat = seats[0];
      const person = staff[0];
      if (!seat || !person) continue;
      // The CSV column combines stations and administrative divisions. Chief
      // 300 rows explicitly say "Division Chief", not a numbered fire station.
      const sourceStation = stationKey(person.station);
      if (
        sourceStation &&
        sourceStation !== 'DIVISIONCHIEF' &&
        stationKey(seat.station) !== sourceStation
      )
        continue;
      const identity = (snapshot.operatorIdentityProjection ?? []).filter(
        (member) => member.employeeId === person.employeeId,
      );
      if (identity.length !== 1 || !identity[0] || !members.has(identity[0].memberId)) continue;
      chiefs.set(seat.id, { memberId: identity[0].memberId, aDay: person.aDayGroup });
    }
  }
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
  const activePositionIds = new Set(
    activeLivePositionIds(
      { live: state?.live ?? null },
      snapshot.ruleBookMaterial.positions.map((position) => position.id),
    ),
  );
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
    ...(chiefs.size && directory
      ? {
          currentStaffing: {
            sourceName: directory.source.name,
            sourceSha256: directory.source.sha256,
            snapshotAt: directory.snapshotAt,
          },
        }
      : {}),
    shifts: selectedShifts.map((shift) => {
      const stationMap = new Map<string, ShiftRosterRow[]>();
      let selected = 0;
      let available = 0;
      const shiftPositions = snapshot.ruleBookMaterial.positions.filter(
        (p) =>
          p.shift === shift &&
          (activePositionIds.has(p.id) || awards.has(p.id) || fixedAssignments.has(p.id)),
      );
      for (const position of shiftPositions) {
        const award = awards.get(position.id);
        // A canonical temporary duty takes precedence over the current directory
        // occupant for that nonbiddable seat. Never overlay a biddable award.
        const chief = !award && !duties.get(position.id)?.length ? chiefs.get(position.id) : null;
        const fixed =
          !award && !duties.get(position.id)?.length ? fixedAssignments.get(position.id) : null;
        const assignedMemberId = fixed?.memberId ?? chief?.memberId ?? null;
        const member = award
          ? members.get(award.memberId)
          : assignedMemberId !== null
            ? members.get(assignedMemberId)
            : null;
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
          ...(position.division !== undefined ? { division: position.division } : {}),
          ...(position.isFloating !== undefined ? { isFloating: position.isFloating } : {}),
          isExcludedFromCount: position.isExcludedFromCount,
          member: award
            ? memberLabel(award.memberId)
            : assignedMemberId !== null
              ? memberLabel(assignedMemberId)
              : null,
          memberRank: member?.rank ?? null,
          aDay: award
            ? award.aDay === null
              ? award.deferred
                ? 'Deferred'
                : 'Not selected'
              : aDayLabel(award.aDay)
            : chief?.aDay && (!fixed || fixed.memberId === chief.memberId)
              ? aDayLabel(chief.aDay)
              : null,
          status,
          markers: [
            ...(fixed || chief ? ['Admin assigned'] : []),
            ...(award?.forced ? ['Forced'] : []),
            ...(award?.aDayOverride ? ['A-Day override'] : []),
          ],
          temporaryDuties: duties.get(position.id) ?? [],
          ...(fixed || chief ? { administrativeAssignment: true } : {}),
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
  currentStaffing?: CurrentStaffingReceipt | null,
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
  const roster = buildShiftRoster({
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
    ...(currentStaffing !== undefined ? { currentStaffing } : {}),
  });
  if (state && !session.isMock) {
    const source = await loadFinalResultSource(database, sessionId, state.lastSeq);
    const finalRows = new Map(source?.rows.map((row) => [row.position_id, row]) ?? []);
    for (const shift of roster.shifts)
      for (const station of shift.stations)
        for (const row of station.rows) {
          const final = finalRows.get(row.positionId);
          if (!final) continue;
          row.position = final.position_label;
          row.unit = final.bid_selection_label;
          row.division = final.division_label;
          row.memberRank = final.rank_label;
          row.aDay = final.a_day_label;
          row.isFloating = final.assignment_type === 'Floating';
        }
  }
  return roster;
}
