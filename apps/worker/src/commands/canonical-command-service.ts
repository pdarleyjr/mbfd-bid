import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { evaluateEligibility } from '@mbfd/eligibility';
import {
  BID_EVENT_VERSION,
  type FrozenLiveBidPolicy,
  type LiveBidCommand,
  type LiveBidCommandResult,
  type MockFreezeCommand,
  type MockFreezeCommandResult,
} from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { ulid } from 'ulid';
import { validateTermDeparture } from '../lib/term-departure.js';

import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import { handleFreeze } from '../durable/bid-session-handlers.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { assertBidDefinitionRunIntegrity } from '../lib/bid-definition-integrity.js';
import { evaluateBidFallback } from '../lib/bid-fallback.js';
import { resolveBidPoolSelection } from '../lib/bid-opportunity-pool.js';
import {
  eligibilityMemberFromFrozen,
  loadFrozenSessionBidPolicy,
  resolveFrozenSessionBidTarget,
} from '../lib/bid-policy.js';
import { unresolvedSpecialtyPriority } from '../lib/canonical-specialty-priority.js';
import { evaluateFrozenSimultaneousADays } from '../lib/frozen-a-day.js';
import { reduceLiveBidCommand } from './live-bid-reducer.js';

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

interface FrozenPreferenceSheetRow {
  member_id: number;
  position_preferences_json: string;
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
  await assertBidDefinitionRunIntegrity(db, bidSessionId);
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
  await assertBidDefinitionRunIntegrity(db, command.bidSessionId);
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

export interface CommitLiveBidCommandInput {
  db: D1Database;
  command: LiveBidCommand;
  state: BidSessionState;
  policy: FrozenLiveBidPolicy;
  nowMs?: () => number;
  newId?: () => string;
}

/** Real-session command bundle.  D1 is the sole authority; the DO only
 * serializes and then projects this returned state for sockets/restarts. */
export async function commitLiveBidCommand(
  input: CommitLiveBidCommandInput,
): Promise<{ result: LiveBidCommandResult; canonicalState: BidSessionState | null }> {
  await assertBidDefinitionRunIntegrity(input.db, input.command.bidSessionId, input.policy);
  const now = (input.nowMs ?? Date.now)();
  const newId = input.newId ?? ulid;
  const requestSha256 = sha256Hex(canonicalJson(input.command));
  const prior = await first<CommandReceiptRow>(
    input.db,
    'SELECT request_sha256, outcome, result_json FROM bid_command_receipts WHERE command_id = ?',
    [input.command.commandId],
  );
  if (prior) {
    if (prior.request_sha256 !== requestSha256)
      return {
        result: {
          kind: 'rejected',
          commandId: input.command.commandId,
          code: 'COMMAND_ID_REUSED',
          currentSeq: input.state.lastSeq,
        },
        canonicalState: null,
      };
    const result = parseStoredResult(prior.result_json) as LiveBidCommandResult;
    return {
      result,
      canonicalState:
        prior.outcome === 'accepted'
          ? await loadCanonicalBidSessionState(input.db, input.command.bidSessionId)
          : null,
    };
  }
  const existing = await loadCanonicalStateRow(input.db, input.command.bidSessionId);
  const current =
    existing?.state ?? normalizeStateForSession(input.state, input.command.bidSessionId);
  if (input.command.expectedSeq !== current.lastSeq) {
    const result: LiveBidCommandResult = {
      kind: 'rejected',
      commandId: input.command.commandId,
      code: 'STALE_SEQUENCE',
      currentSeq: current.lastSeq,
    };
    await insertRejectedReceipt(
      input.db,
      input.command as unknown as MockFreezeCommand,
      requestSha256,
      result as unknown as MockFreezeCommandResult,
      now,
    );
    return { result, canonicalState: null };
  }
  if (
    input.command.type === 'live.record_selection' &&
    input.command.preferenceSheetId !== undefined &&
    input.command.preferenceSheetId !== null
  ) {
    const sheet = await first<FrozenPreferenceSheetRow>(
      input.db,
      "SELECT member_id, position_preferences_json FROM bid_preference_sheets WHERE id = ? AND bid_session_id = ? AND status = 'FROZEN'",
      [input.command.preferenceSheetId, input.command.bidSessionId],
    );
    let preferencePositions: unknown = null;
    try {
      preferencePositions = sheet === null ? null : JSON.parse(sheet.position_preferences_json);
    } catch {
      preferencePositions = null;
    }
    if (
      sheet === null ||
      sheet.member_id !== input.command.memberId ||
      !Array.isArray(preferencePositions) ||
      !preferencePositions.includes(input.command.positionId)
    ) {
      const result: LiveBidCommandResult = {
        kind: 'rejected',
        commandId: input.command.commandId,
        code: 'FROZEN_PREFERENCE_SHEET_INVALID',
        currentSeq: current.lastSeq,
      };
      await insertRejectedReceipt(
        input.db,
        input.command as unknown as MockFreezeCommand,
        requestSha256,
        result as unknown as MockFreezeCommandResult,
        now,
      );
      return { result, canonicalState: null };
    }
  }
  let fallbackReview: Extract<ReturnType<typeof evaluateBidFallback>, { ok: true }> | null = null;
  if ('fallback' in input.command && input.command.fallback !== undefined) {
    const frozen = await loadFrozenSessionBidPolicy(getDb(input.db), input.command.bidSessionId);
    const review =
      frozen.ok &&
      frozen.snapshot.settings.v === 3 &&
      canonicalJson(frozen.snapshot.settings.livePolicy) === canonicalJson(input.policy)
        ? evaluateBidFallback({
            snapshot: frozen.snapshot,
            state: current,
            positionId: input.command.positionId,
          })
        : { ok: false as const, code: 'FROZEN_FALLBACK_POLICY_UNAVAILABLE' };
    const expectedMode = input.command.type === 'live.force_selection' ? 'FORCED' : 'VOLUNTARY';
    const code = !review.ok
      ? review.code
      : review.policyId !== input.command.fallback.policyId ||
          review.tierId !== input.command.fallback.tierId
        ? 'FALLBACK_TIER_NOT_ACTIVE'
        : review.mode !== expectedMode
          ? 'FALLBACK_ACTION_NOT_ALLOWED'
          : review.candidateMemberIds[0] !== input.command.memberId
            ? 'FALLBACK_CANDIDATE_OUT_OF_ORDER'
            : null;
    if (code !== null) {
      const result: LiveBidCommandResult = {
        kind: 'rejected',
        commandId: input.command.commandId,
        code,
        currentSeq: current.lastSeq,
      };
      await insertRejectedReceipt(
        input.db,
        input.command as unknown as MockFreezeCommand,
        requestSha256,
        result as unknown as MockFreezeCommandResult,
        now,
      );
      return { result, canonicalState: null };
    }
    if (review.ok) fallbackReview = review;
  } else if (
    input.command.type === 'live.force_selection' &&
    input.policy.annualOperations?.fallbackPolicies !== undefined
  ) {
    const result: LiveBidCommandResult = {
      kind: 'rejected',
      commandId: input.command.commandId,
      code: 'FALLBACK_REVIEW_REQUIRED',
      currentSeq: current.lastSeq,
    };
    await insertRejectedReceipt(
      input.db,
      input.command as unknown as MockFreezeCommand,
      requestSha256,
      result as unknown as MockFreezeCommandResult,
      now,
    );
    return { result, canonicalState: null };
  }
  if (input.command.type === 'live.start_specialty_adjudication') {
    const specialtyId = input.command.specialtyId;
    const target =
      current.currentBidderId === null
        ? null
        : await resolveFrozenSessionBidTarget(getDb(input.db), {
            bidSessionId: input.command.bidSessionId,
            memberId: current.currentBidderId,
            positionId: input.command.positionId,
          });
    let code: string | null = null;
    try {
      if (
        !target?.ok ||
        target.snapshot.settings.v !== 3 ||
        canonicalJson(target.snapshot.settings.livePolicy) !== canonicalJson(input.policy)
      )
        code = 'LIVE_SPECIALTY_POLICY_MISSING';
      else {
        const expected = unresolvedSpecialtyPriority({
          snapshot: target.snapshot,
          state: current,
          memberId: target.member.memberId,
          positionId: input.command.positionId,
          rule: target.rule,
        }).find((entry) => entry.specialtyId === specialtyId)?.candidateMemberIds;
        if (
          !expected?.length ||
          canonicalJson(expected) !== canonicalJson(input.command.candidateMemberIds)
        )
          code = 'SPECIALTY_CANDIDATE_ORDER_INVALID';
      }
    } catch (error) {
      code = error instanceof Error ? error.message : 'LIVE_SPECIALTY_POLICY_INVALID';
    }
    if (code !== null) {
      const result: LiveBidCommandResult = {
        kind: 'rejected',
        commandId: input.command.commandId,
        code,
        currentSeq: current.lastSeq,
      };
      await insertRejectedReceipt(
        input.db,
        input.command as unknown as MockFreezeCommand,
        requestSha256,
        result as unknown as MockFreezeCommandResult,
        now,
      );
      return { result, canonicalState: null };
    }
  }
  const reduction = reduceLiveBidCommand(
    current,
    input.policy,
    input.command,
    now,
    newId(),
    fallbackReview !== null,
  );
  if (!reduction.ok) {
    const result: LiveBidCommandResult = {
      kind: 'rejected',
      commandId: input.command.commandId,
      code: reduction.code,
      currentSeq: current.lastSeq,
    };
    await insertRejectedReceipt(
      input.db,
      input.command as unknown as MockFreezeCommand,
      requestSha256,
      result as unknown as MockFreezeCommandResult,
      now,
    );
    return { result, canonicalState: null };
  }
  // Every accepted award, including amendment and specialty interruption, must
  // pass the same frozen evaluator as ordinary picks. A stage grant alone is
  // not evidence of eligibility. Evaluate the proposed changes before D1 writes.
  for (const [positionId, fill] of Object.entries(reduction.state.fills)) {
    const previous = current.fills[positionId];
    if (previous?.memberId === fill.memberId && previous.bidId === fill.bidId) continue;
    if (
      (input.policy.annualOperations?.opportunityPools?.length ?? 0) > 0 ||
      ('pool' in input.command && input.command.pool !== undefined)
    ) {
      const frozen = await loadFrozenSessionBidPolicy(getDb(input.db), input.command.bidSessionId);
      const pooled =
        frozen.ok &&
        frozen.snapshot.settings.v === 3 &&
        canonicalJson(frozen.snapshot.settings.livePolicy) === canonicalJson(input.policy)
          ? resolveBidPoolSelection({
              material: frozen.snapshot.ruleBookMaterial,
              policy: input.policy,
              fills: current.fills,
              positionId,
              ...('pool' in input.command && input.command.pool
                ? { poolId: input.command.pool.poolId }
                : {}),
            })
          : {
              ok: false as const,
              code: frozen.ok ? 'FROZEN_POOL_POLICY_UNAVAILABLE' : frozen.code.toUpperCase(),
            };
      if (!pooled.ok) {
        const rejected: LiveBidCommandResult = {
          kind: 'rejected',
          commandId: input.command.commandId,
          code: pooled.code,
          currentSeq: current.lastSeq,
        };
        await insertRejectedReceipt(
          input.db,
          input.command as unknown as MockFreezeCommand,
          requestSha256,
          rejected as unknown as MockFreezeCommandResult,
          now,
        );
        return { result: rejected, canonicalState: null };
      }
      if (pooled.pool)
        reduction.payload.pool = {
          poolId: pooled.pool.id,
          label: pooled.pool.label,
          kind: pooled.pool.kind,
          sourceRef: pooled.pool.sourceRef,
          sourceDecisionId: pooled.pool.sourceDecisionId,
          positionId,
        };
    }
    const target = await resolveFrozenSessionBidTarget(getDb(input.db), {
      bidSessionId: input.command.bidSessionId,
      memberId: fill.memberId,
      positionId,
    });
    const termDeparture = target.ok
      ? validateTermDeparture({ member: target.member, command: input.command, nowMs: now })
      : null;
    const code =
      termDeparture && !termDeparture.ok
        ? termDeparture.code
        : !target.ok
          ? target.code.toUpperCase()
          : target.snapshot.settings.v !== 3 ||
              canonicalJson(target.snapshot.settings.livePolicy) !== canonicalJson(input.policy)
            ? 'LIVE_POLICY_MISMATCH'
            : !evaluateEligibility(
                  eligibilityMemberFromFrozen(target.member),
                  fallbackReview?.rule ?? target.rule,
                ).eligible
              ? 'MEMBER_NOT_ELIGIBLE'
              : null;
    if (code !== null) {
      const rejected: LiveBidCommandResult = {
        kind: 'rejected',
        commandId: input.command.commandId,
        code,
        currentSeq: current.lastSeq,
      };
      await insertRejectedReceipt(
        input.db,
        input.command as unknown as MockFreezeCommand,
        requestSha256,
        rejected as unknown as MockFreezeCommandResult,
        now,
      );
      return { result: rejected, canonicalState: null };
    }
    if (termDeparture?.ok && termDeparture.election) {
      reduction.state.fills[positionId] = { ...fill, termDeparture: termDeparture.election };
      reduction.payload.termDeparture = termDeparture.election;
    }
    // Explicit reviewed fallback tiers have their own qualification and order
    // authority. Ordinary awards cannot bypass an interrupting ranked pool.
    if (fallbackReview === null && target.ok) {
      let priorityCode: string | null = null;
      try {
        const pending = unresolvedSpecialtyPriority({
          snapshot: target.snapshot,
          state: current,
          memberId: fill.memberId,
          positionId,
          rule: target.rule,
        });
        if (pending.some((entry) => entry.candidateMemberIds.length > 0))
          priorityCode = 'SPECIALTY_HIGHER_PRIORITY_UNRESOLVED';
      } catch (error) {
        priorityCode = error instanceof Error ? error.message : 'LIVE_SPECIALTY_POLICY_INVALID';
      }
      if (priorityCode !== null) {
        const rejected: LiveBidCommandResult = {
          kind: 'rejected',
          commandId: input.command.commandId,
          code: priorityCode,
          currentSeq: current.lastSeq,
        };
        await insertRejectedReceipt(
          input.db,
          input.command as unknown as MockFreezeCommand,
          requestSha256,
          rejected as unknown as MockFreezeCommandResult,
          now,
        );
        return { result: rejected, canonicalState: null };
      }
    }
  }
  if (fallbackReview !== null)
    reduction.payload.fallback = {
      policyId: fallbackReview.policyId,
      tierId: fallbackReview.tierId,
      sourceRef: fallbackReview.sourceRef,
      sourceDecisionId: fallbackReview.sourceDecisionId,
      comparator: fallbackReview.comparator,
      exhausted: fallbackReview.exhausted,
      eligibleMemberIds: fallbackReview.eligibleMemberIds,
    };
  if (
    input.policy.annualOperations?.aDay.execution !== undefined ||
    input.policy.annualOperations?.membershipDistributions !== undefined ||
    Object.values(reduction.state.fills).some((fill) => fill.membershipIds !== undefined) ||
    Object.values(reduction.state.fills).some((fill) => fill.aDay !== undefined)
  ) {
    const frozen = await loadFrozenSessionBidPolicy(getDb(input.db), input.command.bidSessionId);
    const allocation =
      frozen.ok &&
      frozen.snapshot.settings.v === 3 &&
      canonicalJson(frozen.snapshot.settings.livePolicy) === canonicalJson(input.policy)
        ? evaluateFrozenSimultaneousADays(frozen.snapshot, reduction.state, {
            nowMs: now,
            actorId: input.command.actor.id,
            forced: input.command.type === 'live.force_selection',
            finalize: input.command.type === 'live.complete_session',
          })
        : { ok: false as const, code: 'FROZEN_A_DAY_POLICY_UNAVAILABLE' };
    if (!allocation.ok) {
      const rejected: LiveBidCommandResult = {
        kind: 'rejected',
        commandId: input.command.commandId,
        code: allocation.code,
        currentSeq: current.lastSeq,
      };
      await insertRejectedReceipt(
        input.db,
        input.command as unknown as MockFreezeCommand,
        requestSha256,
        rejected as unknown as MockFreezeCommandResult,
        now,
      );
      return { result: rejected, canonicalState: null };
    }
    reduction.state.aDay = allocation.aDay;
    if ('aDay' in input.command) reduction.payload.aDay = input.command.aDay ?? null;
  }
  const eventId = newId();
  const auditId = newId();
  const outboxId = newId();
  const envelope = {
    v: BID_EVENT_VERSION,
    seq: reduction.state.lastSeq,
    ts: now,
    type: reduction.eventType,
    payload: reduction.payload,
  } as const;
  const result: LiveBidCommandResult = {
    kind: 'accepted',
    commandId: input.command.commandId,
    seq: reduction.state.lastSeq,
    envelope,
  };
  const eventJson = canonicalJson(reduction.payload);
  const archivePayload = canonicalJson({
    v: 1,
    command: {
      id: input.command.commandId,
      type: input.command.type,
      requestSha256,
      expectedSeq: input.command.expectedSeq,
    },
    event: {
      id: eventId,
      seq: reduction.state.lastSeq,
      type: reduction.eventType,
      payload: reduction.payload,
      actorId: input.command.actor.id,
      createdAt: now,
    },
    audit: {
      id: auditId,
      action: input.command.type,
      actorId: input.command.actor.id,
      reason: input.command.reason,
      createdAt: now,
    },
  });
  const statements: D1PreparedStatement[] = [];
  if (!existing)
    statements.push(
      input.db
        .prepare(
          'INSERT INTO canonical_bid_session_state (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at) VALUES (?,?,?,NULL,?,?)',
        )
        .bind(input.command.bidSessionId, current.lastSeq, canonicalJson(current), now, now),
    );
  // Once canonical session state exists, the 0022 guards intentionally reject
  // every legacy `bids` projection write. Selections, amendments, and specialty
  // awards therefore remain solely in the canonical state plus the immutable
  // receipt/event/audit bundle committed below. Writing both authorities here
  // would either fail the command atomically or permit divergent Bid truth.
  if (input.command.type === 'live.record_contact_attempt') {
    const attempt = reduction.state.annual?.contactAttempts.at(-1);
    if (attempt === undefined) throw new Error('Accepted contact reduction is missing its attempt');
    const attemptNumber = reduction.state.annual?.contactAttempts.filter(
      (entry) => entry.memberId === attempt.memberId,
    ).length;
    statements.push(
      input.db
        .prepare(
          "INSERT INTO bid_contact_attempts (id,bid_session_id,member_id,attempt_number,method,operator_member_id,attempted_at,disposition,created_at) VALUES (?,?,?,?,?,?,?,'RECORDED',?)",
        )
        .bind(
          newId(),
          input.command.bidSessionId,
          attempt.memberId,
          attemptNumber,
          attempt.method,
          attempt.actorMemberId,
          attempt.atMs,
          now,
        ),
    );
  }
  const unreachableMemberId =
    input.command.type === 'live.declare_unreachable' ||
    ((input.command.type === 'live.resolve_specialty_candidate' ||
      input.command.type === 'live.record_fallback_response') &&
      input.command.outcome === 'UNREACHABLE')
      ? input.command.memberId
      : input.command.type === 'live.disposition' && input.command.disposition === 'UNREACHABLE'
        ? current.currentBidderId
        : null;
  if (unreachableMemberId !== null) {
    statements.push(
      input.db
        .prepare(
          `UPDATE bid_contact_attempts SET disposition='UNREACHABLE'
            WHERE bid_session_id=? AND member_id=?
              AND attempt_number=(
                SELECT MAX(attempt_number) FROM bid_contact_attempts
                WHERE bid_session_id=? AND member_id=?
              )`,
        )
        .bind(
          input.command.bidSessionId,
          unreachableMemberId,
          input.command.bidSessionId,
          unreachableMemberId,
        ),
    );
  }
  if (input.command.type === 'live.checkpoint') {
    const checkpoint = reduction.state.annual?.checkpoint;
    if (checkpoint === null || checkpoint === undefined)
      throw new Error('Accepted checkpoint reduction is missing checkpoint state');
    statements.push(
      input.db
        .prepare(
          'INSERT INTO bid_session_checkpoints (id,bid_session_id,command_id,name,actor_member_id,session_sequence,checkpoint_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(
          newId(),
          input.command.bidSessionId,
          input.command.commandId,
          checkpoint.name,
          checkpoint.actorMemberId,
          checkpoint.sequence,
          canonicalJson(reduction.state),
          now,
        ),
    );
  }
  statements.push(
    input.db
      .prepare(
        'UPDATE canonical_bid_session_state SET current_seq=?,state_json=?,last_command_id=?,updated_at=? WHERE bid_session_id=? AND current_seq=?',
      )
      .bind(
        reduction.state.lastSeq,
        canonicalJson(reduction.state),
        input.command.commandId,
        now,
        input.command.bidSessionId,
        current.lastSeq,
      ),
    input.db
      .prepare(
        "INSERT INTO bid_command_receipts (command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at) VALUES (?,?,?,?,?,?,?,'accepted',?,?)",
      )
      .bind(
        input.command.commandId,
        input.command.bidSessionId,
        input.command.type,
        requestSha256,
        input.command.actor.id,
        input.command.expectedSeq,
        reduction.state.lastSeq,
        canonicalJson(result),
        now,
      ),
    input.db
      .prepare(
        "INSERT INTO audit_log (id,bid_session_id,seq,actor_type,actor_id,action,target_kind,target_id,before_state,after_state,reason,ai_advisory_id,client_meta,created_at) SELECT ?,?,COALESCE(MAX(seq),0)+1,'admin',?,?,'session',?,?,?,?,NULL,NULL,? FROM audit_log WHERE bid_session_id=?",
      )
      .bind(
        auditId,
        input.command.bidSessionId,
        input.command.actor.id,
        input.command.type,
        input.command.bidSessionId,
        canonicalJson(current),
        canonicalJson(reduction.state),
        input.command.reason,
        Math.floor(now / 1000),
        input.command.bidSessionId,
      ),
    input.db
      .prepare(
        'INSERT INTO bid_command_events (id,bid_session_id,command_id,audit_log_id,seq,event_type,event_json,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        eventId,
        input.command.bidSessionId,
        input.command.commandId,
        auditId,
        reduction.state.lastSeq,
        reduction.eventType,
        eventJson,
        input.command.actor.id,
        now,
      ),
    input.db
      .prepare(
        "INSERT INTO bid_audit_outbox (id,bid_session_id,command_id,event_id,archive_key,payload_json,payload_sha256,status,attempts,next_attempt_at,lease_owner,lease_expires_at,archived_at,last_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',0,?,NULL,NULL,NULL,NULL,?,?)",
      )
      .bind(
        outboxId,
        input.command.bidSessionId,
        input.command.commandId,
        eventId,
        `canonical-audit/${input.command.bidSessionId}/${String(reduction.state.lastSeq).padStart(12, '0')}-${eventId}.json`,
        archivePayload,
        sha256Hex(archivePayload),
        now,
        now,
        now,
      ),
  );
  await input.db.batch(statements);
  return { result, canonicalState: reduction.state };
}
