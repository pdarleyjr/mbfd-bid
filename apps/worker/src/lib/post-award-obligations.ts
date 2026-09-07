import type { PostAwardObligation } from '@mbfd/shared';
import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { loadOfficialAnnualCompletion } from './official-annual-completion.js';

export function obligationDueOn(
  awardedAtMs: number,
  deadline: PostAwardObligation['deadline'],
): string | null {
  if (
    !Number.isSafeInteger(awardedAtMs) ||
    awardedAtMs <= 0 ||
    !Number.isFinite(new Date(awardedAtMs).getTime())
  )
    return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: deadline.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(awardedAtMs));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const approvedStart =
    deadline.basis === 'APPROVED_BID_START_DATE'
      ? new Date(`${deadline.startOn}T00:00:00.000Z`)
      : null;
  if (
    approvedStart &&
    deadline.basis === 'APPROVED_BID_START_DATE' &&
    (!Number.isFinite(approvedStart.getTime()) ||
      approvedStart.toISOString().slice(0, 10) !== deadline.startOn)
  )
    return null;
  const year = approvedStart ? approvedStart.getUTCFullYear() : part('year');
  const month = approvedStart ? approvedStart.getUTCMonth() + 1 : part('month');
  const day = approvedStart ? approvedStart.getUTCDate() : part('day');
  const due = new Date(0);
  due.setUTCFullYear(year, month - 1, day);
  if (deadline.unit === 'CALENDAR_DAYS') due.setUTCDate(day + deadline.count);
  else {
    due.setUTCDate(1);
    due.setUTCMonth(month - 1 + deadline.count);
    const lastDay = new Date(due);
    lastDay.setUTCMonth(due.getUTCMonth() + 1, 0);
    due.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  }
  return due.toISOString().slice(0, 10);
}

export type AwardEvent = {
  id: string;
  commandId: string;
  commandType: string;
  seq: number;
  createdAtMs: number;
  payload: unknown;
};
/** Accepted canonical events identify the final award and its award-based clock.
 * Explicit approved-start dates come only from frozen obligation terms. No
 * fallback to completion time, mutable legacy bids, or today's date is permitted. */
export function finalAwardEvidence(
  events: readonly AwardEvent[],
  fill: { bidId: string; memberId: number },
  positionId: string,
  completion: { revision: number; completedAtMs: number },
) {
  const matches = events.filter((event) => {
    if (
      event.seq > completion.revision ||
      event.createdAtMs > completion.completedAtMs ||
      event.createdAtMs <= 0 ||
      !Number.isSafeInteger(event.createdAtMs)
    )
      return false;
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const p = payload as Record<string, unknown>;
    return (
      [
        'record_selection',
        'force_selection',
        'amend_selection',
        'resolve_specialty_candidate',
      ].includes(String(p.operation)) &&
      event.commandType === `live.${p.operation}` &&
      (p.bidId ?? p.replacementBidId) === fill.bidId &&
      p.memberId === fill.memberId &&
      (p.positionId ?? p.toPositionId) === positionId &&
      (p.operation !== 'resolve_specialty_candidate' || p.outcome === 'ACCEPT')
    );
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
export type ObligationReview = {
  id: string;
  finalBidId: string;
  obligationId: string;
  revision: number;
  effectiveOn: string;
  status: 'COMPLETED' | 'PENDING' | 'UNKNOWN';
  completedOn: string | null;
  sourceRef: string;
  reason: string;
  actorSubject: string;
};
export async function loadPostAwardObligations(db: D1Database, sessionId: string, asOf: string) {
  const official = await loadOfficialAnnualCompletion(db, sessionId);
  if (!official.ok) return official;
  const state = await loadCanonicalBidSessionState(db, sessionId);
  if (!state || state.lastSeq !== official.completion.completion.revision)
    return { ok: false as const, error: 'official_completion_changed' };
  const [eventRows, reviewRows] = await Promise.all([
    db
      .prepare(
        `SELECT e.id,e.command_id AS commandId,r.command_type AS commandType,e.seq,e.created_at AS createdAtMs,e.event_json AS eventJson FROM bid_command_events e JOIN bid_command_receipts r ON r.command_id=e.command_id AND r.bid_session_id=e.bid_session_id WHERE e.bid_session_id=? AND r.outcome='accepted' AND r.result_seq=e.seq AND e.seq<=? ORDER BY e.seq`,
      )
      .bind(sessionId, state.lastSeq)
      .all<{
        id: string;
        commandId: string;
        commandType: string;
        seq: number;
        createdAtMs: number;
        eventJson: string;
      }>(),
    db
      .prepare(
        'SELECT id,final_bid_id AS finalBidId,obligation_id AS obligationId,revision,effective_on AS effectiveOn,status,completed_on AS completedOn,source_ref AS sourceRef,reason,actor_subject AS actorSubject FROM post_award_obligation_reviews WHERE bid_session_id=? ORDER BY revision DESC',
      )
      .bind(sessionId)
      .all<ObligationReview>(),
  ]);
  const events: AwardEvent[] = eventRows.results.map(({ eventJson, ...row }) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(eventJson);
    } catch {}
    return { ...row, payload };
  });
  const rules = new Map(official.coverage.rules.map((r) => [r.positionId, r]));
  const members = new Map(
    (official.snapshot.operatorIdentityProjection ?? []).map((m) => [m.memberId, m]),
  );
  const obligations = Object.entries(state.fills)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([positionId, fill]) => {
      const award = finalAwardEvidence(events, fill, positionId, official.completion.completion);
      return (rules.get(positionId)?.requiredCriteria.postAward ?? []).map((term) => {
        const history = reviewRows.results.filter(
          (r) => r.finalBidId === fill.bidId && r.obligationId === term.id,
        );
        const review = history.find((r) => r.effectiveOn <= asOf) ?? null;
        const dueOn = award ? obligationDueOn(award.createdAtMs, term.deadline) : null;
        const member = members.get(fill.memberId);
        return {
          term,
          positionId,
          memberId: fill.memberId,
          memberName: member ? `${member.firstName} ${member.lastName}` : null,
          finalBidId: fill.bidId,
          award: award
            ? {
                eventId: award.id,
                commandId: award.commandId,
                seq: award.seq,
                awardedAtMs: award.createdAtMs,
              }
            : null,
          dueOn,
          status: !award
            ? 'AWARD_EVIDENCE_UNKNOWN'
            : review?.status === 'COMPLETED'
              ? 'COMPLETED'
              : review?.status === 'UNKNOWN'
                ? 'UNKNOWN'
                : dueOn && dueOn < asOf
                  ? 'PAST_DUE_REVIEW_REQUIRED'
                  : 'PENDING',
          completionTiming:
            review?.status === 'COMPLETED' && review.completedOn && dueOn
              ? review.completedOn <= dueOn
                ? 'ON_TIME'
                : 'AFTER_DEADLINE'
              : null,
          review,
          history,
          latestRevision: history[0]?.revision ?? 0,
        };
      });
    });
  return {
    ok: true as const,
    sessionId,
    asOf,
    completion: official.completion.completion,
    obligations,
  };
}
