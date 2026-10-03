import type { FrozenLiveBidPolicy } from '@mbfd/shared';
import type { BidSessionState, LiveBidProgress } from '../durable/bid-session-state.js';
import {
  loadDepartmentOrganization,
  resolveDepartmentPositionOrganization,
} from './department-organization.js';
import { canonicalRosterShift, isCalendarDate } from './department-roster.js';

export type AudienceQueueState = Pick<
  BidSessionState,
  'fills' | 'bidOrder' | 'queueCursor' | 'currentBidderId' | 'currentPhase' | 'aDay'
> & { live?: Pick<LiveBidProgress, 'dispositions' | 'exceptionalAssignments'> };

/** An early specialty award keeps its ordinary A-Day turn. Repeated eligible
 * stages never create duplicate people in the audience queue. */
export function remainingAudienceQueue(state: AudienceQueueState, policy?: FrozenLiveBidPolicy) {
  const picked = new Set(state.aDay?.picks.map((pick) => pick.memberId) ?? []);
  const assigned = new Set(
    (state.live?.exceptionalAssignments ?? [])
      .filter((assignment) => assignment.releasedAtMs === null)
      .map((assignment) => assignment.memberId),
  );
  const awards = new Map(
    Object.entries(state.fills).map(([positionId, fill]) => [fill.memberId, { positionId, fill }]),
  );
  const execution = policy?.annualOperations?.aDay.execution;
  function needsADay(memberId: number) {
    const award = awards.get(memberId);
    if (!award || picked.has(memberId) || award.fill.aDay !== undefined) return false;
    if (state.currentPhase === 'a_day_bid' && state.currentBidderId === memberId) return true;
    const exceptions =
      execution?.timingExceptions?.filter((entry) =>
        entry.positionIds.includes(award.positionId),
      ) ?? [];
    if (exceptions.length > 1) return false;
    const timing = exceptions[0]?.timing ?? execution?.timing;
    return (
      timing === 'AFTER_POSITION_SELECTION' ||
      award.fill.aDayDeferral?.positionId === award.positionId
    );
  }
  const seen = new Set<number>();
  const candidates = [
    ...(state.currentBidderId === null ? [] : [state.currentBidderId]),
    ...state.bidOrder.slice(state.queueCursor).map((entry) => entry.memberId),
    ...state.bidOrder.slice(0, state.queueCursor).map((entry) => entry.memberId),
  ];
  return candidates.flatMap((memberId) => {
    if (seen.has(memberId) || assigned.has(memberId)) return [];
    seen.add(memberId);
    const pendingADay = needsADay(memberId);
    if (awards.has(memberId) && !pendingADay) return [];
    const disposition = [...(state.live?.dispositions ?? [])]
      .reverse()
      .find((entry) => entry.memberId === memberId);
    const rule = policy?.dispositions.find(
      (entry) => entry.disposition === disposition?.disposition,
    );
    if (rule && (rule.terminal || !rule.retainsLaterSelectionRights)) return [];
    return [{ memberId, pendingADay }];
  });
}

export type AudienceAssignment = {
  position_id: string;
  position_name: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
};

/** Documentary roster context only, at the supplied MBFD calendar date. Draft, future,
 * expired and ambiguous assignments are never presented as a current seat. */
export async function loadAudienceCurrentAssignment(
  db: D1Database,
  memberId: number | null,
  asOf: string | undefined,
): Promise<AudienceAssignment | null> {
  if (memberId === null || asOf === undefined || !isCalendarDate(asOf)) return null;
  try {
    const rows = await db
      .prepare(`SELECT p.id AS position_id, p.position_name,
      p.shift, p.station, p.unit, p.division FROM member_assignments a
      JOIN staffing_positions p ON p.id=a.staffing_position_id
      WHERE a.member_id=? AND p.review_status IN ('approved','retired')
        AND a.id=(SELECT candidate.id FROM member_assignments candidate
          WHERE candidate.staffing_position_id=p.id
          AND (candidate.status IN ('planned','active') OR
            (candidate.status IN ('ended','superseded') AND candidate.effective_to IS NOT NULL))
          AND candidate.effective_from<=?
          AND (candidate.effective_to IS NULL OR candidate.effective_to>=?)
          ORDER BY candidate.effective_from DESC,candidate.created_at DESC,candidate.id DESC LIMIT 1)
        AND a.effective_from<=? AND (a.effective_to IS NULL OR a.effective_to>=?)
        AND (p.active_from IS NULL OR p.active_from<=?)
        AND (p.active_to IS NULL OR p.active_to>=?) LIMIT 2`)
      .bind(memberId, asOf, asOf, asOf, asOf, asOf, asOf)
      .all<AudienceAssignment & { division: string | null }>();
    if (rows.results.length !== 1) return null;
    const assignment = rows.results[0];
    if (!assignment) return null;
    const organization = resolveDepartmentPositionOrganization(
      { ...assignment, id: assignment.position_id },
      await loadDepartmentOrganization(db, asOf),
    );
    return {
      position_id: assignment.position_id,
      position_name: assignment.position_name,
      shift: canonicalRosterShift(assignment.shift),
      station: organization.station,
      unit: organization.unit,
    };
  } catch {
    // Missing documentary context must not erase an authoritative live board.
    return null;
  }
}
