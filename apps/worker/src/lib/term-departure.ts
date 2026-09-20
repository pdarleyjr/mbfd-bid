import {
  type FrozenBidEligibilityMember,
  type LiveBidCommand,
  TermDepartureElectionSchema,
} from '@mbfd/shared';
import type { Fill } from '../durable/bid-session-state.js';

/** A permission to bid out never establishes consent. Every changed voluntary
 * award requires a fresh explicit election bound to the frozen assignment. */
export function validateTermDeparture(input: {
  member: FrozenBidEligibilityMember;
  command: LiveBidCommand;
  nowMs: number;
}): { ok: true; election?: NonNullable<Fill['termDeparture']> } | { ok: false; code: string } {
  const rights = input.member.termParticipation;
  const supplied = 'termDeparture' in input.command ? input.command.termDeparture : undefined;
  if (!rights)
    return supplied === undefined
      ? { ok: true }
      : { ok: false, code: 'TERM_DEPARTURE_NOT_APPLICABLE' };
  if (input.command.type === 'live.force_selection')
    return { ok: false, code: 'TERM_DEPARTURE_VOLUNTARY_ONLY' };
  if (
    !(
      input.command.type === 'live.record_selection' ||
      input.command.type === 'live.amend_selection' ||
      (input.command.type === 'live.resolve_specialty_candidate' &&
        input.command.outcome === 'ACCEPT')
    )
  )
    return { ok: false, code: 'TERM_DEPARTURE_VOLUNTARY_ONLY' };
  const parsed = TermDepartureElectionSchema.safeParse(supplied);
  if (!parsed.success) return { ok: false, code: 'TERM_DEPARTURE_ELECTION_REQUIRED' };
  if (
    parsed.data.assignmentId !== rights.assignmentId ||
    input.command.memberId !== input.member.memberId
  )
    return { ok: false, code: 'TERM_DEPARTURE_ASSIGNMENT_MISMATCH' };
  return {
    ok: true,
    election: {
      ...parsed.data,
      commandId: input.command.commandId,
      actorMemberId: input.command.actor.id,
      recordedAtMs: input.nowMs,
    },
  };
}

export function validFrozenTermElection(member: FrozenBidEligibilityMember, fill: Fill): boolean {
  const rights = member.termParticipation;
  if (!rights) return fill.termDeparture === undefined;
  const election = fill.termDeparture;
  return (
    election !== undefined &&
    TermDepartureElectionSchema.safeParse({
      assignmentId: election.assignmentId,
      memberConfirmed: election.memberConfirmed,
      evidenceReference: election.evidenceReference,
    }).success &&
    election.assignmentId === rights.assignmentId &&
    Number.isSafeInteger(election.actorMemberId) &&
    election.actorMemberId > 0 &&
    Number.isSafeInteger(election.recordedAtMs) &&
    election.recordedAtMs > 0 &&
    typeof election.commandId === 'string' &&
    election.commandId.length > 0
  );
}

/** Verify the immutable accepted command that created this final election.
 * Current staffing evidence is never substituted for the frozen right. */
export async function hasAcceptedTermElection(
  db: D1Database,
  sessionId: string,
  member: FrozenBidEligibilityMember,
  fill: Fill,
): Promise<boolean> {
  if (!validFrozenTermElection(member, fill)) return false;
  if (!member.termParticipation) return true;
  const election = fill.termDeparture;
  if (!election) return false;
  const row = await db
    .prepare(`SELECT e.event_json AS eventJson,e.actor_id AS actorId,r.command_type AS commandType
    FROM bid_command_events e JOIN bid_command_receipts r ON r.command_id=e.command_id AND r.bid_session_id=e.bid_session_id
    WHERE e.bid_session_id=? AND e.command_id=? AND r.outcome='accepted' AND r.result_seq=e.seq`)
    .bind(sessionId, election.commandId)
    .first<{ eventJson: string; actorId: number; commandType: string }>();
  if (
    !row ||
    row.actorId !== election.actorMemberId ||
    !['live.record_selection', 'live.amend_selection', 'live.resolve_specialty_candidate'].includes(
      row.commandType,
    )
  )
    return false;
  try {
    const event = JSON.parse(row.eventJson) as Record<string, unknown>;
    const recorded = event.termDeparture as Fill['termDeparture'];
    return (
      (event.bidId === fill.bidId || event.replacementBidId === fill.bidId) &&
      event.memberId === member.memberId &&
      recorded?.assignmentId === election.assignmentId &&
      recorded.memberConfirmed === true &&
      recorded.evidenceReference === election.evidenceReference &&
      recorded.commandId === election.commandId &&
      recorded.actorMemberId === election.actorMemberId &&
      recorded.recordedAtMs === election.recordedAtMs
    );
  } catch {
    return false;
  }
}
