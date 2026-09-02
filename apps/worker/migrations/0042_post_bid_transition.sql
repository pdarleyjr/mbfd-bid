-- 0041 is reserved for Worker 2 year-round persistence.  Post-Bid state is
-- intentionally additive and anchors every result to an immutable annual
-- session; it never overwrites member_assignments or TeleStaff observations.

CREATE TABLE bid_post_bid_transitions (
  bid_session_id TEXT PRIMARY KEY NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  bid_year INTEGER NOT NULL REFERENCES bid_years(year) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('REVIEWED', 'APPROVED', 'PACKAGE_GENERATED', 'RECONCILED', 'PUBLISHED')),
  policy_version TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  annual_completion_at INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL,
  reviewed_by_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  approved_at INTEGER,
  approved_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  effective_on TEXT,
  future_roster_json TEXT NOT NULL,
  package_generated_at INTEGER,
  reconciliation_json TEXT,
  reconciled_at INTEGER,
  reconciled_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  published_at INTEGER,
  published_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_bid_post_bid_transitions_year_status
  ON bid_post_bid_transitions (bid_year, status, effective_on);

CREATE TABLE bid_post_bid_operation_receipts (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('FINALIZATION_REVIEW', 'APPROVE', 'PACKAGE', 'RECONCILE', 'PUBLISH')),
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  actor_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_bid_post_bid_operation_receipts_session_operation
  ON bid_post_bid_operation_receipts (bid_session_id, operation, created_at);
