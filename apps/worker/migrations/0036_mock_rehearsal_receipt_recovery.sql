-- Recovery is additive. Do not ALTER or rebuild the 0035 receipt table: this
-- repository contains an earlier fail-closed staffing trigger that SQLite must
-- reparse on any ALTER TABLE operation. The sidecar makes a historical pending
-- receipt terminal without weakening or rewriting its immutable identity.
CREATE TABLE mock_rehearsal_command_recovery_outcomes (
  bid_session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('not_applied', 'recovery_required')),
  response_status INTEGER NOT NULL CHECK (response_status = 409),
  response_json TEXT NOT NULL CHECK (json_valid(response_json) = 1),
  recovery_reason TEXT NOT NULL CHECK (length(trim(recovery_reason)) > 0),
  recovered_by TEXT NOT NULL CHECK (recovered_by = 'system_recovery'),
  recovered_at INTEGER NOT NULL,
  PRIMARY KEY (bid_session_id, idempotency_key),
  FOREIGN KEY (bid_session_id, idempotency_key)
    REFERENCES mock_rehearsal_command_receipts (bid_session_id, idempotency_key)
    ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX idx_mock_rehearsal_command_recovery_outcomes_recovered_at
  ON mock_rehearsal_command_recovery_outcomes (bid_session_id, recovered_at);
--> statement-breakpoint
CREATE TRIGGER mock_rehearsal_command_recovery_outcomes_requires_pending_receipt
BEFORE INSERT ON mock_rehearsal_command_recovery_outcomes
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM mock_rehearsal_command_receipts receipt
  WHERE receipt.bid_session_id = NEW.bid_session_id
    AND receipt.idempotency_key = NEW.idempotency_key
    AND receipt.state = 'pending'
)
BEGIN SELECT RAISE(ABORT, 'mock rehearsal recovery outcome requires a pending receipt'); END;
--> statement-breakpoint
CREATE TRIGGER mock_rehearsal_command_recovery_outcomes_no_replace
BEFORE INSERT ON mock_rehearsal_command_recovery_outcomes
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM mock_rehearsal_command_recovery_outcomes existing
  WHERE existing.bid_session_id = NEW.bid_session_id
    AND existing.idempotency_key = NEW.idempotency_key
)
BEGIN SELECT RAISE(ABORT, 'mock rehearsal recovery outcome cannot be replaced'); END;
--> statement-breakpoint
CREATE TRIGGER mock_rehearsal_command_recovery_outcomes_immutable
BEFORE UPDATE ON mock_rehearsal_command_recovery_outcomes
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'mock rehearsal recovery outcome is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER mock_rehearsal_command_recovery_outcomes_no_delete
BEFORE DELETE ON mock_rehearsal_command_recovery_outcomes
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'mock rehearsal recovery outcome cannot be deleted'); END;
