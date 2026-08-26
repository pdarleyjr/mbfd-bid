-- MBFD Bid V2 canonical staffing/import foundation.
--
-- These source-backed draft tables intentionally separate an authorized
-- staffing slot, an observed/current member assignment, and a staged import.
-- They do not infer vacancy, capacity, policy, or an award from an occupancy
-- export. Raw TeleStaff/personnel material is not stored here.

CREATE TABLE staffing_positions (
  id TEXT PRIMARY KEY NOT NULL,
  source_system TEXT NOT NULL,
  source_record_key TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  division TEXT,
  station TEXT,
  unit TEXT,
  position_name TEXT,
  shift TEXT,
  -- Source-system A/R-day notation; this is not the legacy Bid A-Day value.
  a_r_day TEXT,
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'approved', 'retired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX staffing_positions_source_identity_unique
  ON staffing_positions (source_system, source_record_key, source_version);
--> statement-breakpoint
CREATE INDEX idx_staffing_positions_review_status
  ON staffing_positions (review_status);

CREATE TABLE assignment_imports (
  id TEXT PRIMARY KEY NOT NULL,
  source_system TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'reviewed', 'approved', 'committed', 'rejected')),
  input_row_count INTEGER NOT NULL DEFAULT 0 CHECK (input_row_count >= 0),
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  approved_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  committed_at INTEGER,
  CHECK (
    status <> 'approved'
    OR (approved_at IS NOT NULL AND approved_by_member_id IS NOT NULL)
  ),
  CHECK (
    status <> 'committed'
    OR (
      approved_at IS NOT NULL
      AND approved_by_member_id IS NOT NULL
      AND committed_at IS NOT NULL
      AND approved_at <= committed_at
    )
  ),
  CHECK (status = 'committed' OR committed_at IS NULL)
);
--> statement-breakpoint
CREATE INDEX idx_assignment_imports_status_created
  ON assignment_imports (status, created_at);

CREATE TABLE assignment_import_rows (
  id TEXT PRIMARY KEY NOT NULL,
  import_id TEXT NOT NULL REFERENCES assignment_imports(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  row_fingerprint TEXT NOT NULL CHECK (length(row_fingerprint) = 64),
  -- HMAC-SHA-256 reference; the key remains outside D1 and source artifacts.
  member_reference_hmac TEXT CHECK (member_reference_hmac IS NULL OR length(member_reference_hmac) = 64),
  staffing_position_id TEXT REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL DEFAULT 'ambiguous_mapping'
    CHECK (disposition IN (
      'unchanged',
      'moved',
      'new_combination',
      'missing_vanished',
      'unknown_employee',
      'ambiguous_mapping'
    )),
  reviewed_at INTEGER,
  reviewed_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_import_rows_import_row_unique
  ON assignment_import_rows (import_id, source_row_number);
--> statement-breakpoint
CREATE INDEX idx_assignment_import_rows_disposition
  ON assignment_import_rows (import_id, disposition);

CREATE TABLE member_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  staffing_position_id TEXT NOT NULL REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  source_import_id TEXT NOT NULL REFERENCES assignment_imports(id) ON DELETE RESTRICT,
  observed_at INTEGER NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_member_assignments_member_observed
  ON member_assignments (member_id, observed_at);
--> statement-breakpoint
CREATE INDEX idx_member_assignments_position_observed
  ON member_assignments (staffing_position_id, observed_at);

CREATE TABLE assignment_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  source_system TEXT NOT NULL,
  source_alias TEXT NOT NULL,
  staffing_position_id TEXT NOT NULL REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  source_import_id TEXT REFERENCES assignment_imports(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_aliases_source_unique
  ON assignment_aliases (source_system, source_alias);

CREATE TABLE assignment_service_history (
  id TEXT PRIMARY KEY NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  staffing_position_id TEXT REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  source_import_id TEXT REFERENCES assignment_imports(id) ON DELETE RESTRICT,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  record_kind TEXT NOT NULL CHECK (record_kind IN ('assignment', 'service')),
  effective_from TEXT,
  effective_to TEXT,
  recorded_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_assignment_service_history_member_recorded
  ON assignment_service_history (member_id, recorded_at);
