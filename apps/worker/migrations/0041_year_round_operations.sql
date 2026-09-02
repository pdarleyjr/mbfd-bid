-- Intentionally follows Worker 3's reserved 0040_annual_bid_operations.sql during integration.
-- Isolated year-round review/overlay evidence; it never mutates frozen Bid snapshots.
CREATE TABLE IF NOT EXISTS qualification_review_batches (
  id TEXT PRIMARY KEY, source_system TEXT NOT NULL, source_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged','reviewed','applied','cancelled')),
  created_by_subject TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS qualification_review_rows (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES qualification_review_batches(id),
  member_id INTEGER REFERENCES members(id), credential_id INTEGER REFERENCES credentials(id),
  source_member_reference TEXT NOT NULL, source_credential_reference TEXT NOT NULL,
  effective_on TEXT, expires_on TEXT, source_status TEXT NOT NULL,
  provenance TEXT NOT NULL, classification TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('accepted','rejected','needs_review')),
  reviewed_by_subject TEXT, reviewed_at INTEGER, applied_event_id TEXT REFERENCES member_qualification_events(id),
  idempotency_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qualification_review_rows_batch ON qualification_review_rows(batch_id, classification, decision);
CREATE TABLE IF NOT EXISTS temporary_operational_overlays (
  id TEXT PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('SPECIAL_ASSIGNMENT','LIGHT_DUTY')),
  underlying_assignment_id TEXT NOT NULL REFERENCES member_assignments(id),
  temporary_position_id TEXT, effective_on TEXT NOT NULL, planned_end_on TEXT, actual_end_on TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','ended','cancelled')),
  provenance TEXT NOT NULL, notes TEXT, actor_subject TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, ended_by_subject TEXT
);
CREATE INDEX IF NOT EXISTS idx_temporary_operational_overlays_member_active ON temporary_operational_overlays(member_id, status, effective_on);
