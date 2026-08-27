-- Canonical command/audit/outbox foundation.
--
-- D1 is authoritative for accepted commands. A named Durable Object
-- serializes commands for one session, and a D1 batch commits the canonical
-- state transition, receipt, immutable event, flat audit row, and retryable
-- R2 archive work item together. R2 delivery is intentionally asynchronous:
-- an archive outage must never reject an already committed command.

CREATE TABLE canonical_bid_session_state (
  bid_session_id TEXT PRIMARY KEY NOT NULL
    REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  current_seq INTEGER NOT NULL CHECK (current_seq >= 0),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  last_command_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    CASE WHEN json_valid(state_json) THEN COALESCE(
      json_type(state_json, '$.bidSessionId') = 'text'
      AND json_extract(state_json, '$.bidSessionId') = bid_session_id
      AND json_type(state_json, '$.lastSeq') = 'integer'
      AND json_extract(state_json, '$.lastSeq') = current_seq,
      0
    ) ELSE 0 END
  )
);
--> statement-breakpoint
CREATE TRIGGER canonical_bid_session_state_no_replace
BEFORE INSERT ON canonical_bid_session_state
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state existing
  WHERE existing.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical bid session state identity is immutable');
END;
--> statement-breakpoint
-- A canonical command may seed only a pristine mock session. Legacy picks
-- have no lossless command/event mapping, so importing them here would make
-- the D1 state look authoritative while silently dropping history. The route
-- and command service return a typed 409; this trigger closes their race.
CREATE TRIGGER canonical_bid_session_state_seed_requires_pristine_legacy_state
BEFORE INSERT ON canonical_bid_session_state
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bid_sessions session_record
  WHERE session_record.id = NEW.bid_session_id
    AND session_record.is_mock = 1
)
OR EXISTS (
  SELECT 1 FROM bids legacy_bid
  WHERE legacy_bid.bid_session_id = NEW.bid_session_id
)
OR EXISTS (
  SELECT 1 FROM a_day_picks legacy_a_day_pick
  WHERE legacy_a_day_pick.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical mock seed requires pristine legacy state');
END;
--> statement-breakpoint
CREATE TRIGGER canonical_bid_session_state_must_advance_once
BEFORE UPDATE ON canonical_bid_session_state
FOR EACH ROW
WHEN NEW.bid_session_id <> OLD.bid_session_id
  OR NEW.current_seq <> OLD.current_seq + 1
  OR NEW.last_command_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'canonical bid session state must advance by one command');
END;
--> statement-breakpoint
CREATE TRIGGER canonical_bid_session_state_no_delete
BEFORE DELETE ON canonical_bid_session_state
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'canonical bid session state is not deleted');
END;

CREATE TABLE bid_command_receipts (
  command_id TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL
    REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  command_type TEXT NOT NULL
    CHECK (length(trim(command_type)) > 0 AND command_type = trim(command_type)),
  request_sha256 TEXT NOT NULL
    CHECK (
      typeof(request_sha256) = 'text'
      AND length(request_sha256) = 64
      AND request_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  actor_id INTEGER NOT NULL,
  expected_seq INTEGER NOT NULL CHECK (expected_seq >= 0),
  result_seq INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at INTEGER NOT NULL,
  CHECK (
    (
      outcome = 'accepted'
      AND result_seq IS NOT NULL
      AND result_seq = expected_seq + 1
    )
    OR (outcome = 'rejected' AND result_seq IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX idx_bid_command_receipts_session_created
  ON bid_command_receipts (bid_session_id, created_at);
--> statement-breakpoint
CREATE TRIGGER bid_command_receipts_no_replace
BEFORE INSERT ON bid_command_receipts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM bid_command_receipts existing
  WHERE existing.command_id = NEW.command_id
)
BEGIN
  SELECT RAISE(ABORT, 'command receipt identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER bid_command_receipts_accepted_state_binding
BEFORE INSERT ON bid_command_receipts
FOR EACH ROW
WHEN NEW.outcome = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_bid_session_state state_record
    WHERE state_record.bid_session_id = NEW.bid_session_id
      AND state_record.current_seq = NEW.result_seq
      AND state_record.last_command_id = NEW.command_id
  )
BEGIN
  SELECT RAISE(ABORT, 'accepted command receipt is not bound to canonical state');
END;
--> statement-breakpoint
CREATE TRIGGER bid_command_receipts_no_update
BEFORE UPDATE ON bid_command_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'command receipt is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER bid_command_receipts_no_delete
BEFORE DELETE ON bid_command_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'command receipt is immutable');
END;

CREATE TABLE bid_command_events (
  id TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL
    REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  command_id TEXT NOT NULL
    REFERENCES bid_command_receipts(command_id) ON DELETE RESTRICT,
  audit_log_id TEXT NOT NULL
    REFERENCES audit_log(id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  event_type TEXT NOT NULL
    CHECK (length(trim(event_type)) > 0 AND event_type = trim(event_type)),
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  actor_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (command_id),
  UNIQUE (audit_log_id),
  UNIQUE (bid_session_id, seq)
);
--> statement-breakpoint
CREATE INDEX idx_bid_command_events_session_created
  ON bid_command_events (bid_session_id, created_at);
--> statement-breakpoint
CREATE TRIGGER bid_command_events_no_replace
BEFORE INSERT ON bid_command_events
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM bid_command_events existing
  WHERE existing.id = NEW.id
     OR existing.command_id = NEW.command_id
     OR existing.audit_log_id = NEW.audit_log_id
     OR (existing.bid_session_id = NEW.bid_session_id AND existing.seq = NEW.seq)
)
BEGIN
  SELECT RAISE(ABORT, 'command event identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER bid_command_events_must_bind_accepted_receipt
BEFORE INSERT ON bid_command_events
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM bid_command_receipts receipt
    INNER JOIN audit_log audit_record ON audit_record.id = NEW.audit_log_id
    WHERE receipt.command_id = NEW.command_id
     AND receipt.bid_session_id = NEW.bid_session_id
     AND receipt.outcome = 'accepted'
     AND receipt.result_seq = NEW.seq
     AND receipt.actor_id = NEW.actor_id
     AND audit_record.bid_session_id = NEW.bid_session_id
     AND audit_record.actor_id = NEW.actor_id
  )
BEGIN
  SELECT RAISE(ABORT, 'command event must bind matching accepted receipt and audit evidence');
END;
--> statement-breakpoint
CREATE TRIGGER bid_command_events_no_update
BEFORE UPDATE ON bid_command_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'command event is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER bid_command_events_no_delete
BEFORE DELETE ON bid_command_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'command event is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_after_command_event
BEFORE UPDATE ON audit_log
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM bid_command_events event_record
  WHERE event_record.audit_log_id = OLD.id
)
AND (
  NEW.id IS NOT OLD.id
  OR NEW.bid_session_id IS NOT OLD.bid_session_id
  OR NEW.seq IS NOT OLD.seq
  OR NEW.actor_type IS NOT OLD.actor_type
  OR NEW.actor_id IS NOT OLD.actor_id
  OR NEW.action IS NOT OLD.action
  OR NEW.target_kind IS NOT OLD.target_kind
  OR NEW.target_id IS NOT OLD.target_id
  OR NEW.before_state IS NOT OLD.before_state
  OR NEW.after_state IS NOT OLD.after_state
  OR NEW.reason IS NOT OLD.reason
  OR NEW.ai_advisory_id IS NOT OLD.ai_advisory_id
  OR NEW.client_meta IS NOT OLD.client_meta
  OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.chunk_seq IS NULL AND NEW.chunk_row_index IS NOT NULL)
  OR (NEW.chunk_seq IS NOT NULL AND NEW.chunk_row_index IS NULL)
  OR (
    (OLD.chunk_seq IS NOT NULL OR OLD.chunk_row_index IS NOT NULL)
    AND (
      NEW.chunk_seq IS NOT OLD.chunk_seq
      OR NEW.chunk_row_index IS NOT OLD.chunk_row_index
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'canonical command audit row is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete_after_command_event
BEFORE DELETE ON audit_log
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM bid_command_events event_record
  WHERE event_record.audit_log_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical command audit row is immutable');
END;

CREATE TABLE bid_audit_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL
    REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  command_id TEXT NOT NULL
    REFERENCES bid_command_receipts(command_id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL
    REFERENCES bid_command_events(id) ON DELETE RESTRICT,
  archive_key TEXT NOT NULL
    CHECK (length(trim(archive_key)) > 0 AND archive_key = trim(archive_key)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_sha256 TEXT NOT NULL
    CHECK (
      typeof(payload_sha256) = 'text'
      AND length(payload_sha256) = 64
      AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'retry', 'archived', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  archived_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (event_id),
  UNIQUE (archive_key),
  CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status = 'archived' AND archived_at IS NOT NULL)
    OR (status <> 'archived' AND archived_at IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX idx_bid_audit_outbox_due
  ON bid_audit_outbox (status, next_attempt_at);
--> statement-breakpoint
CREATE TRIGGER bid_audit_outbox_no_replace
BEFORE INSERT ON bid_audit_outbox
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM bid_audit_outbox existing
  WHERE existing.id = NEW.id
     OR existing.event_id = NEW.event_id
     OR existing.archive_key = NEW.archive_key
)
BEGIN
  SELECT RAISE(ABORT, 'audit outbox identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER bid_audit_outbox_must_bind_event
BEFORE INSERT ON bid_audit_outbox
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM bid_command_events event_record
  WHERE event_record.id = NEW.event_id
    AND event_record.bid_session_id = NEW.bid_session_id
    AND event_record.command_id = NEW.command_id
)
BEGIN
  SELECT RAISE(ABORT, 'audit outbox must bind its canonical command event');
END;
--> statement-breakpoint
CREATE TRIGGER bid_audit_outbox_delivery_only_updates
BEFORE UPDATE ON bid_audit_outbox
FOR EACH ROW
WHEN NEW.id <> OLD.id
  OR NEW.bid_session_id <> OLD.bid_session_id
  OR NEW.command_id <> OLD.command_id
  OR NEW.event_id <> OLD.event_id
  OR NEW.archive_key <> OLD.archive_key
  OR NEW.payload_json <> OLD.payload_json
  OR NEW.payload_sha256 <> OLD.payload_sha256
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'audit outbox payload is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER bid_audit_outbox_attempts_are_monotonic
BEFORE UPDATE OF attempts ON bid_audit_outbox
FOR EACH ROW
WHEN NEW.attempts < OLD.attempts
BEGIN
  SELECT RAISE(ABORT, 'audit outbox attempts are immutable in reverse');
END;
--> statement-breakpoint
CREATE TRIGGER bid_audit_outbox_no_delete
BEFORE DELETE ON bid_audit_outbox
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'audit outbox record is immutable');
END;
--> statement-breakpoint
-- Once a session has canonical command state, legacy REST/rehearsal writes
-- cannot create a second, diverging source of bid truth. Route-level guards
-- provide a clear 409; these D1 constraints close the race before INSERT.
CREATE TRIGGER bids_legacy_insert_requires_canonical_command
BEFORE INSERT ON bids
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER bids_legacy_authority_update_requires_canonical_command
BEFORE UPDATE OF
  bid_session_id,
  ordinal,
  member_id,
  position_id,
  a_day,
  picked_at,
  forced,
  admin_actor_id,
  reason,
  idempotency_key
ON bids
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = OLD.bid_session_id
     OR state_record.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER bids_legacy_delete_requires_canonical_command
BEFORE DELETE ON bids
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = OLD.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER a_day_picks_legacy_insert_requires_canonical_command
BEFORE INSERT ON a_day_picks
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER a_day_picks_legacy_authority_update_requires_canonical_command
BEFORE UPDATE OF
  bid_session_id,
  member_id,
  shift,
  a_day,
  picked_at,
  forced,
  admin_actor_id,
  reason,
  idempotency_key
ON a_day_picks
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = OLD.bid_session_id
     OR state_record.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER a_day_picks_legacy_delete_requires_canonical_command
BEFORE DELETE ON a_day_picks
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = OLD.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER bid_order_legacy_insert_requires_canonical_command
BEFORE INSERT ON bid_order
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER bid_order_legacy_update_requires_canonical_command
BEFORE UPDATE ON bid_order
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = OLD.bid_session_id
     OR state_record.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER bid_order_legacy_delete_requires_canonical_command
BEFORE DELETE ON bid_order
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = OLD.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
--> statement-breakpoint
CREATE TRIGGER bid_sessions_legacy_state_update_requires_canonical_command
BEFORE UPDATE OF
  current_phase,
  current_bidder_id,
  current_turn_started_at,
  paused_at,
  completed_at,
  scheduled_resume_at,
  day_count,
  frozen_at,
  freeze_actor_id,
  freeze_reason,
  turn_timer_seconds,
  config_json,
  is_mock
ON bid_sessions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM canonical_bid_session_state state_record
  WHERE state_record.bid_session_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session mutation requires command');
END;
