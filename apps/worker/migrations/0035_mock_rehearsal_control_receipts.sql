-- Mock rehearsal control-plane receipts are deliberately separate from the
-- canonical Bid command ledger. They make a lost auto-bid/manual-pick HTTP
-- response replayable without allowing a second legacy rehearsal mutation.
--
-- The session revision is an additive optimistic token. Existing sessions
-- start at zero; a completed mock command advances it exactly once.
ALTER TABLE bid_sessions
  ADD COLUMN mock_control_revision INTEGER NOT NULL DEFAULT 0
  CHECK (mock_control_revision >= 0);
--> statement-breakpoint

CREATE TRIGGER bid_sessions_mock_control_revision_cannot_decrease
BEFORE UPDATE OF mock_control_revision ON bid_sessions
FOR EACH ROW
WHEN NEW.mock_control_revision < OLD.mock_control_revision
BEGIN
  SELECT RAISE(ABORT, 'mock control revision cannot decrease');
END;
--> statement-breakpoint

CREATE TABLE mock_rehearsal_command_receipts (
  bid_session_id TEXT NOT NULL
    REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL
    CHECK (
      length(trim(idempotency_key)) > 0
      AND length(idempotency_key) <= 160
      AND idempotency_key = trim(idempotency_key)
    ),
  operation TEXT NOT NULL
    CHECK (operation IN ('auto_bid', 'manual_pick')),
  actor_subject TEXT NOT NULL
    CHECK (length(trim(actor_subject)) > 0 AND actor_subject = trim(actor_subject)),
  request_fingerprint TEXT NOT NULL
    CHECK (
      typeof(request_fingerprint) = 'text'
      AND length(request_fingerprint) = 64
      AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
  expected_mock_control_revision INTEGER NOT NULL
    CHECK (expected_mock_control_revision >= 0),
  state TEXT NOT NULL
    CHECK (state IN ('pending', 'completed')),
  response_status INTEGER,
  response_json TEXT,
  resulting_mock_control_revision INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (bid_session_id, idempotency_key),
  CHECK (
    (
      state = 'pending'
      AND response_status IS NULL
      AND response_json IS NULL
      AND resulting_mock_control_revision IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'completed'
      AND response_status BETWEEN 100 AND 599
      AND response_json IS NOT NULL
      AND json_valid(response_json) = 1
      AND resulting_mock_control_revision = expected_mock_control_revision + 1
      AND completed_at IS NOT NULL
      AND completed_at >= created_at
    )
  )
);
--> statement-breakpoint

CREATE INDEX idx_mock_rehearsal_command_receipts_session_created
  ON mock_rehearsal_command_receipts (bid_session_id, created_at);
--> statement-breakpoint

-- `INSERT OR REPLACE` can otherwise bypass a DELETE trigger when SQLite runs
-- with recursive triggers disabled. Reject an identity collision before that
-- implicit delete can happen.
CREATE TRIGGER mock_rehearsal_command_receipts_no_replace
BEFORE INSERT ON mock_rehearsal_command_receipts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM mock_rehearsal_command_receipts existing
  WHERE existing.bid_session_id = NEW.bid_session_id
    AND existing.idempotency_key = NEW.idempotency_key
)
BEGIN
  SELECT RAISE(ABORT, 'mock rehearsal command receipt cannot be replaced');
END;
--> statement-breakpoint

-- The only legal change is one durable completion. Request identity and the
-- expected revision never change, and table checks require the completed
-- response payload/status and the resulting revision at the same time.
CREATE TRIGGER mock_rehearsal_command_receipts_completion_only
BEFORE UPDATE ON mock_rehearsal_command_receipts
FOR EACH ROW
WHEN NOT (
  OLD.state = 'pending'
  AND NEW.state = 'completed'
  AND NEW.bid_session_id = OLD.bid_session_id
  AND NEW.idempotency_key = OLD.idempotency_key
  AND NEW.operation = OLD.operation
  AND NEW.actor_subject = OLD.actor_subject
  AND NEW.request_fingerprint = OLD.request_fingerprint
  AND NEW.expected_mock_control_revision = OLD.expected_mock_control_revision
  AND NEW.created_at = OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'mock rehearsal command receipt permits only pending completion');
END;
--> statement-breakpoint

CREATE TRIGGER mock_rehearsal_command_receipts_no_delete
BEFORE DELETE ON mock_rehearsal_command_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'mock rehearsal command receipt cannot be deleted');
END;
