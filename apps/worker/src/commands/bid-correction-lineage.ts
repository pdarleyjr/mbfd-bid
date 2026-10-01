import type { LiveBidCommand } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { unresolvedBidCorrections } from '../lib/bid-corrections.js';

/** Source receipts are session-bound accepted facts. A current Fill alone is
 * insufficient authority to correct a historical or already superseded bid. */
export async function validateBidCorrectionLineage(
  db: D1Database,
  state: BidSessionState,
  command: Extract<LiveBidCommand, { type: 'live.correct_bid' }>,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const active = state.fills[command.originalPositionId];
  const pending = unresolvedBidCorrections(state).find(
    (entry) =>
      entry.bidId === command.originalBidId &&
      entry.commandId === command.originalCommandId &&
      entry.before.positionId === command.originalPositionId,
  );
  const source = active?.bidId === command.originalBidId ? active : pending?.before.fill;
  if (source === undefined) return { ok: false, code: 'CORRECTION_SOURCE_NOT_ACTIVE' };
  if (source.memberId !== command.memberId)
    return { ok: false, code: 'CORRECTION_MEMBER_MISMATCH' };
  const row = await db
    .prepare(`SELECT r.outcome,r.result_seq,e.seq,e.event_json
    FROM bid_command_receipts r JOIN bid_command_events e ON e.command_id=r.command_id AND e.bid_session_id=r.bid_session_id
    WHERE r.command_id=? AND r.bid_session_id=?`)
    .bind(command.originalCommandId, command.bidSessionId)
    .first<{ outcome: string; result_seq: number; seq: number; event_json: string }>();
  if (!row || row.outcome !== 'accepted' || row.result_seq !== row.seq || row.seq > state.lastSeq)
    return { ok: false, code: 'CORRECTION_SOURCE_RECEIPT_INVALID' };
  try {
    const event = JSON.parse(row.event_json) as Record<string, unknown>;
    const after = event.after as
      | { positionId?: string; fill?: { bidId?: string; memberId?: number } }
      | null
      | undefined;
    const eventBidId = event.bidId ?? event.replacementBidId;
    const eventPositionId = pending
      ? pending.before.positionId
      : (after?.positionId ?? event.positionId ?? event.toPositionId);
    if (
      (eventBidId !== command.originalBidId && event.replacementBidId !== command.originalBidId) ||
      event.memberId !== command.memberId ||
      eventPositionId !== command.originalPositionId ||
      (pending &&
        (event.operation !== 'correct_bid' ||
          event.correctionOperation !== 'REVOKE' ||
          event.after !== null))
    )
      return { ok: false, code: 'CORRECTION_SOURCE_RECEIPT_INVALID' };
  } catch {
    return { ok: false, code: 'CORRECTION_SOURCE_RECEIPT_INVALID' };
  }
  const delayedPick =
    active?.aDay === undefined && pending === undefined
      ? state.aDay?.picks.find((pick) => pick.memberId === command.memberId)
      : undefined;
  if (delayedPick) {
    if (command.originalADayCommandId === null)
      return { ok: false, code: 'CORRECTION_A_DAY_RECEIPT_REQUIRED' };
    const latest = await db
      .prepare(`SELECT e.command_id,e.event_json,r.outcome,r.result_seq,e.seq
      FROM bid_command_events e JOIN bid_command_receipts r ON r.command_id=e.command_id AND r.bid_session_id=e.bid_session_id
      WHERE e.bid_session_id=? AND r.command_type='live.record_a_day' AND json_extract(e.event_json,'$.memberId')=?
      ORDER BY e.seq DESC LIMIT 1`)
      .bind(command.bidSessionId, command.memberId)
      .first<{
        command_id: string;
        event_json: string;
        outcome: string;
        result_seq: number;
        seq: number;
      }>();
    try {
      const event = latest ? (JSON.parse(latest.event_json) as Record<string, unknown>) : null;
      if (
        !latest ||
        latest.command_id !== command.originalADayCommandId ||
        latest.outcome !== 'accepted' ||
        latest.result_seq !== latest.seq ||
        latest.seq > state.lastSeq ||
        event?.aDay !== delayedPick.aDay
      )
        return { ok: false, code: 'CORRECTION_A_DAY_RECEIPT_INVALID' };
    } catch {
      return { ok: false, code: 'CORRECTION_A_DAY_RECEIPT_INVALID' };
    }
  } else if (command.originalADayCommandId !== null)
    return { ok: false, code: 'CORRECTION_A_DAY_RECEIPT_NOT_APPLICABLE' };
  return { ok: true };
}
