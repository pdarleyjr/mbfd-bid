-- Annual Bid Operations: immutable preference-sheet copies, minimal contact
-- evidence, and named continuation checkpoints. These are additive tables;
-- canonical_bid_session_state remains the authoritative live projection.

CREATE TABLE bid_preference_sheets (
  id TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('MEMBER_SUBMISSION', 'OPERATOR_ENTERED')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'REVIEWED', 'FROZEN')),
  submitted_at INTEGER NOT NULL,
  frozen_at INTEGER,
  position_preferences_json TEXT NOT NULL,
  a_day_preferences_json TEXT NOT NULL,
  provenance_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (bid_session_id, member_id)
);

CREATE INDEX idx_bid_preference_sheets_session_status
  ON bid_preference_sheets (bid_session_id, status, member_id);

CREATE TABLE bid_contact_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  method TEXT NOT NULL CHECK (method IN ('PHONE', 'TEXT')),
  operator_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  attempted_at INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('RECORDED', 'UNREACHABLE')),
  created_at INTEGER NOT NULL,
  UNIQUE (bid_session_id, member_id, attempt_number)
);

CREATE INDEX idx_bid_contact_attempts_session_member
  ON bid_contact_attempts (bid_session_id, member_id, attempt_number);

CREATE TABLE bid_session_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  command_id TEXT NOT NULL REFERENCES bid_command_receipts(command_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  actor_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  session_sequence INTEGER NOT NULL CHECK (session_sequence >= 0),
  checkpoint_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (bid_session_id, command_id)
);

CREATE INDEX idx_bid_session_checkpoints_session_sequence
  ON bid_session_checkpoints (bid_session_id, session_sequence DESC, created_at DESC);
