import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import {
  BID_EVENT_VERSION,
  type MockFreezeCommand,
  type MockFreezeCommandResult,
} from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { ulid } from 'ulid';

import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { handleFreeze } from '../durable/bid-session-handlers.js';
import type { BidSessionState } from '../durable/bid-session-state.js';

interface CanonicalStateRow {
  current_seq: number;
  state_json: string;
  last_command_id: string | null;
}

interface CommandReceiptRow {
  request_sha256: string;
  outcome: 'accepted' | 'rejected';
  result_json: string;
}

interface MockSessionRow {
  is_mock: number;
}

interface LegacyPickPresenceRow {
  has_position_bids: number;
  has_a_day_picks: number;
}

export interface CommitMockFreezeCommandInput {
  db: D1Database;
  command: MockFreezeCommand;
  /**
   * DO-local projection used only to seed a session that has not yet issued a
   * canonical command. Once a D1 state row exists, D1 wins on every command
   * and reconstruction.
   */
  state: BidSessionState;
  nowMs?: () => number;
  newId?: () => string;
  /** Invoked immediately before a D1 batch that may commit command state. */
  beforeD1Commit?: () => Promise<void>;
}

export interface CanonicalMockFreezeCommandCommit {
  result: MockFreezeCommandResult;
  /** The D1-authoritative state to project back into the named DO, if accepted. */
  canonicalState: BidSessionState | null;
}

function canonicalJson(value: unknown): string {
  return canonicalize(value as JsonValue);
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

function normalizeStateForSession(state: BidSessionState, bidSessionId: string): BidSessionState {
  return { ...state, bidSessionId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCurrentPhase(value: unknown): value is BidSessionState['currentPhase'] {
  return (
    value === 'config' ||
    value === 'position_bid' ||
    value === 'a_day_bid' ||
    value === 'paused' ||
    value === 'complete'
  );
}

function isPersistedADayState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isRecord(value.groupCaps) || !isRecord(value.weekdayCaps)) return false;
  if (
    !Array.isArray(value.picks) ||
    !Array.isArray(value.bidOrder) ||
    !Array.isArray(value.phase1)
  ) {
    return false;
  }
  if (!isNonnegativeInteger(value.cursor)) return false;
  if (!value.picks.every((pick) => isRecord(pick) && isNonnegativeInteger(pick.memberId))) {
    return false;
  }
  if (!value.bidOrder.every(isNonnegativeInteger)) return false;
  return value.phase1.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      isNonnegativeInteger(entry[0]) &&
      isRecord(entry[1]),
  );
}

function isBidSessionStateProjection(
  value: unknown,
  bidSessionId: string,
  currentSeq: number,
): value is BidSessionState {
  if (!isRecord(value)) return false;
  if (value.bidSessionId !== bidSessionId || value.lastSeq !== currentSeq) return false;
  if (!isCurrentPhase(value.currentPhase)) return false;
  if (value.currentBidderId !== null && !isNonnegativeInteger(value.currentBidderId)) return false;
  if (
    !isNonnegativeInteger(value.turnStartedAtMs) ||
    !isNonnegativeInteger(value.turnTimerSeconds)
  ) {
    return false;
  }
  if (!isRecord(value.fills) || !Array.isArray(value.bidOrder)) return false;
  if (
    !Object.values(value.fills).every(
      (fill) =>
        isRecord(fill) &&
        isNonnegativeInteger(fill.memberId) &&
        isNonnegativeInteger(fill.ordinal) &&
        typeof fill.bidId === 'string' &&
        fill.bidId.length > 0,
    )
  ) {
    return false;
  }
  if (
    !value.bidOrder.every(
      (entry) =>
        isRecord(entry) &&
        isNonnegativeInteger(entry.ordinal) &&
        isNonnegativeInteger(entry.memberId) &&
        (entry.pool === 'OFC' || entry.pool === 'FF'),
    )
  ) {
    return false;
  }
  if (!isNonnegativeInteger(value.queueCursor)) return false;
  if (value.frozenAt !== null && !isNonnegativeInteger(value.frozenAt)) return false;
  return value.aDay === null || isPersistedADayState(value.aDay);
}

function parseCanonicalState(
  raw: string,
  bidSessionId: string,
  currentSeq: number,
): BidSessionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Canonical command state JSON is unreadable');
  }
  if (!isBidSessionStateProjection(parsed, bidSessionId, currentSeq)) {
    throw new Error('Canonical command state is not a valid BidSessionState projection');
  }
  return parsed;
}

function parseStoredResult(raw: string): MockFreezeCommandResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Canonical command receipt JSON is unreadable');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { kind?: unknown }).kind !== 'string' ||
    typeof (parsed as { commandId?: unknown }).commandId !== 'string'
  ) {
    throw new Error('Canonical command receipt JSON is invalid');
  }
  return parsed as MockFreezeCommandResult;
}

async function first<T>(
  db: D1Database,
  query: string,
  values: readonly unknown[],
): Promise<T | null> {
  return (
    (await db
      .prepare(query)
      .bind(...values)
      .first<T>()) ?? null
  );
}

export async function loadCanonicalBidSessionState(
  db: D1Database,
  bidSessionId: string,
): Promise<BidSessionState | null> {
  const row = await first<CanonicalStateRow>(
    db,
    `SELECT current_seq, state_json, last_command_id
       FROM canonical_bid_session_state
      WHERE bid_session_id = ?`,
    [bidSessionId],
  );
  if (row === null) return null;
  return parseCanonicalState(row.state_json, bidSessionId, row.current_seq);
}

/**
 * A malformed canonical row is still canonical for write-protection purposes.
 * Callers that only need to decide whether legacy mutation is forbidden must
 * therefore check row presence rather than parse the JSON projection.
 */
export async function hasCanonicalBidSessionState(
  db: D1Database,
  bidSessionId: string,
): Promise<boolean> {
  return (
    (await first<{ present: number }>(
      db,
      'SELECT 1 AS present FROM canonical_bid_session_state WHERE bid_session_id = ?',
      [bidSessionId],
    )) !== null
  );
}

async function loadCanonicalStateRow(
  db: D1Database,
  bidSessionId: string,
): Promise<{ state: BidSessionState; row: CanonicalStateRow } | null> {
  const row = await first<CanonicalStateRow>(
    db,
    `SELECT current_seq, state_json, last_command_id
       FROM canonical_bid_session_state
      WHERE bid_session_id = ?`,
    [bidSessionId],
  );
  if (row === null) return null;
  return { state: parseCanonicalState(row.state_json, bidSessionId, row.current_seq), row };
}

async function insertRejectedReceipt(
  db: D1Database,
  command: MockFreezeCommand,
  requestSha256: string,
  result: MockFreezeCommandResult,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO bid_command_receipts (
          command_id, bid_session_id, command_type, request_sha256, actor_id,
          expected_seq, result_seq, outcome, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'rejected', ?, ?)`,
      )
      .bind(
        command.commandId,
        command.bidSessionId,
        command.type,
        requestSha256,
        command.actor.id,
        command.expectedSeq,
        canonicalJson(result),
        now,
      ),
  ]);
}

async function legacyPickPresence(
  db: D1Database,
  bidSessionId: string,
): Promise<LegacyPickPresenceRow> {
  const row = await first<LegacyPickPresenceRow>(
    db,
    `SELECT
       EXISTS(SELECT 1 FROM bids WHERE bid_session_id = ?) AS has_position_bids,
       EXISTS(SELECT 1 FROM a_day_picks WHERE bid_session_id = ?) AS has_a_day_picks`,
    [bidSessionId, bidSessionId],
  );
  if (row === null) {
    throw new Error('Unable to determine legacy mock state');
  }
  return row;
}

function unimportedDoStateRejectCode(
  state: BidSessionState,
): 'LEGACY_STATE_REQUIRES_IMPORT' | 'LEGACY_A_DAY_STATE_REQUIRES_IMPORT' | null {
  // WebSocket and force-A-Day paths persist their operational projection in
  // the named DO before their legacy D1 mirror. A freeze must not turn that
  // unimported projection into canonical authority: it would have no command
  // receipt/event/outbox lineage. Prefer the Phase-2 code when both kinds of
  // operational state are present, matching the legacy-D1 preflight below.
  if ((state.aDay?.picks.length ?? 0) > 0) return 'LEGACY_A_DAY_STATE_REQUIRES_IMPORT';
  if (Object.keys(state.fills).length > 0) return 'LEGACY_STATE_REQUIRES_IMPORT';
  return null;
}

/**
 * Commits the rehearsal-only mock freeze command to the D1 authority.
 *
 * `D1Database.batch` is the production transaction boundary: every accepted
 * command writes the durable state, receipt, audit row, immutable event, and
 * retryable R2 archive work item in this order. Archive delivery happens only
 * after this method returns successfully, so a later R2 failure cannot undo
 * or reject the accepted command.
 */
export async function commitMockFreezeCommand(
  input: CommitMockFreezeCommandInput,
): Promise<CanonicalMockFreezeCommandCommit> {
  const { db, command } = input;
  const now = (input.nowMs ?? Date.now)();
  const newId = input.newId ?? ulid;
  const requestSha256 = sha256Hex(canonicalJson(command));

  // The Worker route is the normal authorization boundary, but this method
  // is also reachable through the named DO. Do not let an internal/direct
  // request promote a live session into the rehearsal-only authority.
  const session = await first<MockSessionRow>(db, 'SELECT is_mock FROM bid_sessions WHERE id = ?', [
    command.bidSessionId,
  ]);
  if (session?.is_mock !== 1) {
    return {
      result: {
        kind: 'rejected',
        commandId: command.commandId,
        code: 'NOT_A_MOCK_SESSION',
        currentSeq: input.state.lastSeq,
      },
      canonicalState: null,
    };
  }

  const prior = await first<CommandReceiptRow>(
    db,
    `SELECT request_sha256, outcome, result_json
       FROM bid_command_receipts
      WHERE command_id = ?`,
    [command.commandId],
  );
  if (prior !== null) {
    if (prior.request_sha256 !== requestSha256) {
      const canonical = await loadCanonicalBidSessionState(db, command.bidSessionId);
      return {
        result: {
          kind: 'rejected',
          commandId: command.commandId,
          code: 'COMMAND_ID_REUSED',
          currentSeq: canonical?.lastSeq ?? input.state.lastSeq,
        },
        canonicalState: null,
      };
    }
    const result = parseStoredResult(prior.result_json);
    const canonicalState =
      prior.outcome === 'accepted'
        ? await loadCanonicalBidSessionState(db, command.bidSessionId)
        : null;
    if (prior.outcome === 'accepted' && canonicalState === null) {
      throw new Error('Accepted command receipt is missing canonical state');
    }
    return { result, canonicalState };
  }

  const existing = await loadCanonicalStateRow(db, command.bidSessionId);
  if (existing === null) {
    const inMemoryLegacyCode = unimportedDoStateRejectCode(input.state);
    if (inMemoryLegacyCode !== null) {
      const result: MockFreezeCommandResult = {
        kind: 'rejected',
        commandId: command.commandId,
        code: inMemoryLegacyCode,
        currentSeq: input.state.lastSeq,
      };
      await insertRejectedReceipt(db, command, requestSha256, result, now);
      return { result, canonicalState: null };
    }
    const legacy = await legacyPickPresence(db, command.bidSessionId);
    if (legacy.has_a_day_picks !== 0 || legacy.has_position_bids !== 0) {
      const result: MockFreezeCommandResult = {
        kind: 'rejected',
        commandId: command.commandId,
        code:
          legacy.has_a_day_picks !== 0
            ? 'LEGACY_A_DAY_STATE_REQUIRES_IMPORT'
            : 'LEGACY_STATE_REQUIRES_IMPORT',
        currentSeq: input.state.lastSeq,
      };
      await insertRejectedReceipt(db, command, requestSha256, result, now);
      return { result, canonicalState: null };
    }
  }
  const currentState =
    existing?.state ?? normalizeStateForSession(input.state, command.bidSessionId);
  if (command.expectedSeq !== currentState.lastSeq) {
    const result: MockFreezeCommandResult = {
      kind: 'rejected',
      commandId: command.commandId,
      code: 'STALE_SEQUENCE',
      currentSeq: currentState.lastSeq,
    };
    await insertRejectedReceipt(db, command, requestSha256, result, now);
    return { result, canonicalState: null };
  }

  const frozen = handleFreeze(
    currentState,
    {
      nowMs: () => now,
      newBidId: newId,
      evaluateEligibility: () => ({
        eligible: true,
        reasons: [],
        points: 0,
        soPoints: 0,
        moPoints: 0,
        breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
      }),
    },
    { adminActorId: command.actor.id, reason: command.reason },
  );
  if (frozen.kind === 'rejected') {
    const result: MockFreezeCommandResult = {
      kind: 'rejected',
      commandId: command.commandId,
      code: 'SESSION_FROZEN',
      currentSeq: currentState.lastSeq,
    };
    await insertRejectedReceipt(db, command, requestSha256, result, now);
    return { result, canonicalState: null };
  }

  const canonicalState = frozen.newState;
  const eventId = newId();
  const auditId = newId();
  const outboxId = newId();
  const envelope = {
    v: BID_EVENT_VERSION,
    seq: canonicalState.lastSeq,
    ts: now,
    type: 'freeze' as const,
    payload: frozen.event.payload,
  };
  const result: MockFreezeCommandResult = {
    kind: 'accepted',
    commandId: command.commandId,
    seq: canonicalState.lastSeq,
    envelope,
  };
  const auditAfterState = canonicalJson({ frozen: true });
  const auditReason = `freeze: ${command.reason}`;
  // `audit_log.created_at` predates the canonical tables and is declared as a
  // Drizzle seconds-mode timestamp; the newer canonical records use ms.
  const auditCreatedAtSeconds = Math.floor(now / 1_000);
  const eventJson = canonicalJson(frozen.event.payload);
  const archiveKey = `canonical-audit/${command.bidSessionId}/${String(canonicalState.lastSeq).padStart(12, '0')}-${eventId}.json`;
  const archivePayload = canonicalJson({
    v: 1,
    command: {
      id: command.commandId,
      type: command.type,
      requestSha256,
      expectedSeq: command.expectedSeq,
    },
    event: {
      id: eventId,
      seq: canonicalState.lastSeq,
      type: 'freeze',
      payload: frozen.event.payload,
      actorId: command.actor.id,
      createdAt: now,
    },
    audit: {
      id: auditId,
      action: 'pause',
      actorId: command.actor.id,
      targetKind: 'session',
      targetId: command.bidSessionId,
      afterState: { frozen: true },
      reason: auditReason,
      createdAt: now,
    },
  });

  const statements: D1PreparedStatement[] = [];
  if (existing === null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO canonical_bid_session_state (
            bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?)`,
        )
        .bind(command.bidSessionId, currentState.lastSeq, canonicalJson(currentState), now, now),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE canonical_bid_session_state
            SET current_seq = ?, state_json = ?, last_command_id = ?, updated_at = ?
          WHERE bid_session_id = ? AND current_seq = ?`,
      )
      .bind(
        canonicalState.lastSeq,
        canonicalJson(canonicalState),
        command.commandId,
        now,
        command.bidSessionId,
        currentState.lastSeq,
      ),
    db
      .prepare(
        `INSERT INTO bid_command_receipts (
          command_id, bid_session_id, command_type, request_sha256, actor_id,
          expected_seq, result_seq, outcome, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
      )
      .bind(
        command.commandId,
        command.bidSessionId,
        command.type,
        requestSha256,
        command.actor.id,
        command.expectedSeq,
        canonicalState.lastSeq,
        canonicalJson(result),
        now,
      ),
    db
      .prepare(
        `INSERT INTO audit_log (
          id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at
        )
         SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'pause', 'session',
                ?, NULL, ?, ?, NULL, NULL, ?
           FROM audit_log
          WHERE bid_session_id = ?`,
      )
      .bind(
        auditId,
        command.bidSessionId,
        command.actor.id,
        command.bidSessionId,
        auditAfterState,
        auditReason,
        auditCreatedAtSeconds,
        command.bidSessionId,
      ),
    db
      .prepare(
        `INSERT INTO bid_command_events (
          id, bid_session_id, command_id, audit_log_id, seq, event_type, event_json, actor_id, created_at
        ) VALUES (?, ?, ?, ?, ?, 'freeze', ?, ?, ?)`,
      )
      .bind(
        eventId,
        command.bidSessionId,
        command.commandId,
        auditId,
        canonicalState.lastSeq,
        eventJson,
        command.actor.id,
        now,
      ),
    db
      .prepare(
        `INSERT INTO bid_audit_outbox (
          id, bid_session_id, command_id, event_id, archive_key, payload_json, payload_sha256,
          status, attempts, next_attempt_at, lease_owner, lease_expires_at, archived_at, last_error,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(
        outboxId,
        command.bidSessionId,
        command.commandId,
        eventId,
        archiveKey,
        archivePayload,
        sha256Hex(archivePayload),
        now,
        now,
        now,
      ),
  );

  try {
    await input.beforeD1Commit?.();
    await db.batch(statements);
  } catch (error) {
    // A named DO serializes the normal path, but a retry after an interrupted
    // response can still observe a completed D1 transaction. An exact
    // receipt is a replay; a distinct receipt with the same ID is an
    // idempotency-key conflict. If another command advanced the durable
    // sequence in between the preflight read and this batch, report the
    // typed stale result rather than turning a normal concurrent retry into
    // an opaque server error. Preserve all other integrity failures.
    const replay = await first<CommandReceiptRow>(
      db,
      `SELECT request_sha256, outcome, result_json
         FROM bid_command_receipts
        WHERE command_id = ?`,
      [command.commandId],
    );
    if (replay !== null && replay.request_sha256 === requestSha256) {
      const replayedResult = parseStoredResult(replay.result_json);
      const replayedState =
        replay.outcome === 'accepted'
          ? await loadCanonicalBidSessionState(db, command.bidSessionId)
          : null;
      return { result: replayedResult, canonicalState: replayedState };
    }
    const canonical = await loadCanonicalBidSessionState(db, command.bidSessionId);
    if (replay !== null) {
      return {
        result: {
          kind: 'rejected',
          commandId: command.commandId,
          code: 'COMMAND_ID_REUSED',
          currentSeq: canonical?.lastSeq ?? input.state.lastSeq,
        },
        canonicalState: null,
      };
    }
    if (canonical !== null && canonical.lastSeq > command.expectedSeq) {
      return {
        result: {
          kind: 'rejected',
          commandId: command.commandId,
          code: 'STALE_SEQUENCE',
          currentSeq: canonical.lastSeq,
        },
        canonicalState: null,
      };
    }
    throw error;
  }

  return { result, canonicalState };
}
