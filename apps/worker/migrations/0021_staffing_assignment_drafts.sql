-- MBFD Bid V2 canonical staffing/import foundation.
--
-- This migration is intentionally revised in place because it has not been
-- deployed. It separates the authorized staffing slot from source-system
-- mappings, staged source observations, and authoritative effective-dated
-- assignments. Raw TeleStaff/personnel material is never stored here.

CREATE TABLE staffing_positions (
  id TEXT PRIMARY KEY NOT NULL,
  -- Stable MBFD-owned identity; never a TeleStaff export/version identity.
  stable_slot_key TEXT NOT NULL
    CHECK (length(trim(stable_slot_key)) > 0 AND stable_slot_key = trim(stable_slot_key)),
  division TEXT,
  shift TEXT,
  station TEXT,
  unit TEXT,
  position_name TEXT,
  applicable_rank TEXT,
  active_from TEXT,
  active_to TEXT,
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'approved', 'retired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    active_from IS NULL
    OR (
      length(active_from) = 10
      AND strftime('%Y-%m-%d', active_from) IS NOT NULL
      AND strftime('%Y-%m-%d', active_from) = active_from
    )
  ),
  CHECK (
    active_to IS NULL
    OR (
      length(active_to) = 10
      AND strftime('%Y-%m-%d', active_to) IS NOT NULL
      AND strftime('%Y-%m-%d', active_to) = active_to
    )
  ),
  CHECK (active_to IS NULL OR active_from IS NULL OR active_from <= active_to),
  CHECK (review_status <> 'retired' OR active_to IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX staffing_positions_stable_slot_key_unique
  ON staffing_positions (stable_slot_key);
--> statement-breakpoint
CREATE INDEX idx_staffing_positions_review_status
  ON staffing_positions (review_status);
--> statement-breakpoint
CREATE TRIGGER staffing_positions_stable_slot_key_is_immutable
BEFORE UPDATE OF stable_slot_key ON staffing_positions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'canonical staffing slot identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER staffing_positions_no_authorization_change_that_invalidates_assignment
BEFORE UPDATE OF review_status, active_from, active_to ON staffing_positions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM member_assignments assignment_record
  WHERE assignment_record.staffing_position_id = OLD.id
    AND assignment_record.status IN ('planned', 'active')
    AND (
      NEW.review_status NOT IN ('approved', 'retired')
      OR (
        NEW.active_from IS NOT NULL
        AND NEW.active_from > assignment_record.effective_from
      )
      OR (
        NEW.active_to IS NOT NULL
        AND (
          assignment_record.effective_to IS NULL
          OR assignment_record.effective_to > NEW.active_to
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'slot authorization change would invalidate an assignment');
END;

-- A source system describes a canonical slot through a complete normalized
-- locator/signature. The scope is explicit because short aliases can repeat
-- across shifts, stations, units, and roles.
CREATE TABLE staffing_position_source_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  staffing_position_id TEXT NOT NULL REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  source_system TEXT NOT NULL
    CHECK (length(trim(source_system)) > 0 AND source_system = lower(trim(source_system))),
  source_locator TEXT NOT NULL
    CHECK (length(trim(source_locator)) > 0 AND source_locator = trim(source_locator)),
  source_signature TEXT NOT NULL
    CHECK (
      typeof(source_signature) = 'text'
      AND length(source_signature) = 64
      AND source_signature NOT GLOB '*[^0-9a-f]*'
    ),
  source_version TEXT NOT NULL
    CHECK (
      typeof(source_version) = 'text'
      AND length(trim(source_version, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160))) > 0
      AND source_version = trim(source_version, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160))
    ),
  source_hash TEXT NOT NULL
    CHECK (
      typeof(source_hash) = 'text'
      AND length(source_hash) = 64
      AND source_hash NOT GLOB '*[^0-9a-f]*'
    ),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    length(effective_from) = 10
    AND strftime('%Y-%m-%d', effective_from) IS NOT NULL
    AND strftime('%Y-%m-%d', effective_from) = effective_from
  ),
  CHECK (
    effective_to IS NULL
    OR (
      length(effective_to) = 10
      AND strftime('%Y-%m-%d', effective_to) IS NOT NULL
      AND strftime('%Y-%m-%d', effective_to) = effective_to
    )
  ),
  CHECK (effective_to IS NULL OR effective_from <= effective_to)
);
--> statement-breakpoint
CREATE UNIQUE INDEX staffing_position_source_mapping_locator_unique
  ON staffing_position_source_mappings (
    source_system,
    source_locator,
    effective_from
  );
--> statement-breakpoint
CREATE INDEX idx_staffing_position_source_mappings_slot_effective
  ON staffing_position_source_mappings (staffing_position_id, effective_from);
--> statement-breakpoint
CREATE UNIQUE INDEX staffing_position_source_mappings_id_position_unique
  ON staffing_position_source_mappings (id, staffing_position_id);
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_no_overlapping_scope_insert
BEFORE INSERT ON staffing_position_source_mappings
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM staffing_position_source_mappings existing
  WHERE existing.source_system = NEW.source_system
    AND existing.source_locator = NEW.source_locator
    AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
    AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
)
BEGIN
  SELECT RAISE(ABORT, 'overlapping staffing source mapping scope');
END;
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_no_overlapping_scope_update
BEFORE UPDATE OF source_system, source_locator, effective_from, effective_to
ON staffing_position_source_mappings
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM staffing_position_source_mappings existing
  WHERE existing.id <> NEW.id
    AND existing.source_system = NEW.source_system
    AND existing.source_locator = NEW.source_locator
    AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
    AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
)
BEGIN
  SELECT RAISE(ABORT, 'overlapping staffing source mapping scope');
END;
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_id_is_immutable
BEFORE UPDATE OF id ON staffing_position_source_mappings
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'source mapping identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_no_update_after_committed_reference
BEFORE UPDATE ON staffing_position_source_mappings
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_import_rows row_record
  JOIN assignment_imports import_record ON import_record.id = row_record.import_id
  WHERE row_record.staffing_position_source_mapping_id = OLD.id
    AND (
      import_record.status IN ('approved', 'committed', 'rejected')
      OR row_record.review_status IN ('approved', 'rejected')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'source mapping referenced by a committed import is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_no_delete_after_committed_reference
BEFORE DELETE ON staffing_position_source_mappings
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_import_rows row_record
  JOIN assignment_imports import_record ON import_record.id = row_record.import_id
  WHERE row_record.staffing_position_source_mapping_id = OLD.id
    AND (
      import_record.status IN ('approved', 'committed', 'rejected')
      OR row_record.review_status IN ('approved', 'rejected')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'source mapping referenced by a committed import is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_no_replace_after_committed_reference
BEFORE INSERT ON staffing_position_source_mappings
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM staffing_position_source_mappings existing
  JOIN assignment_import_rows row_record
    ON row_record.staffing_position_source_mapping_id = existing.id
  JOIN assignment_imports import_record ON import_record.id = row_record.import_id
  WHERE (
      import_record.status IN ('approved', 'committed', 'rejected')
      OR row_record.review_status IN ('approved', 'rejected')
    )
    AND (
      existing.id = NEW.id
      OR (
        existing.source_system = NEW.source_system
        AND existing.source_locator = NEW.source_locator
        AND existing.effective_from = NEW.effective_from
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'source mapping referenced by a committed import is immutable');
END;

CREATE TABLE assignment_imports (
  id TEXT PRIMARY KEY NOT NULL,
  source_system TEXT NOT NULL
    CHECK (length(trim(source_system)) > 0 AND source_system = lower(trim(source_system))),
  source_version TEXT NOT NULL
    CHECK (
      typeof(source_version) = 'text'
      AND length(trim(source_version, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160))) > 0
      AND source_version = trim(source_version, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160))
    ),
  source_hash TEXT NOT NULL
    CHECK (
      typeof(source_hash) = 'text'
      AND length(source_hash) = 64
      AND source_hash NOT GLOB '*[^0-9a-f]*'
    ),
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
--> statement-breakpoint
CREATE TRIGGER assignment_imports_must_start_staged
BEFORE INSERT ON assignment_imports
FOR EACH ROW
WHEN NEW.status <> 'staged'
BEGIN
  SELECT RAISE(ABORT, 'assignment imports must start staged');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_no_approval_fields_on_insert
BEFORE INSERT ON assignment_imports
FOR EACH ROW
WHEN NEW.approved_at IS NOT NULL OR NEW.approved_by_member_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'approval fields are set only on reviewed-to-approved transition');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_no_replace_after_commit
BEFORE INSERT ON assignment_imports
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports existing
  WHERE existing.id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'assignment import identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_approval_fields_are_immutable_after_approval
BEFORE UPDATE OF approved_at, approved_by_member_id ON assignment_imports
FOR EACH ROW
WHEN NEW.status <> 'approved'
  OR OLD.status IN ('approved', 'committed', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'approval fields are immutable outside the approval transition');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_require_valid_status_transition
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'staged' AND NEW.status IN ('reviewed', 'rejected'))
  OR (OLD.status = 'reviewed' AND NEW.status IN ('approved', 'rejected'))
  OR (OLD.status = 'approved' AND NEW.status IN ('committed', 'rejected'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid assignment import status transition');
END;

-- Staged source evidence. The source A/R Day remains source assignment data,
-- and a reviewer must record a reason before a review-required row is final.
CREATE TABLE assignment_import_rows (
  id TEXT PRIMARY KEY NOT NULL,
  import_id TEXT NOT NULL REFERENCES assignment_imports(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  row_fingerprint TEXT NOT NULL
    CHECK (
      typeof(row_fingerprint) = 'text'
      AND length(row_fingerprint) = 64
      AND row_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
  -- HMAC-SHA-256 reference; the key remains outside D1 and source artifacts.
  member_reference_hmac TEXT CHECK (
    member_reference_hmac IS NULL
    OR (
      typeof(member_reference_hmac) = 'text'
      AND
      length(member_reference_hmac) = 64
      AND member_reference_hmac NOT GLOB '*[^0-9a-f]*'
    )
  ),
  resolved_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  staffing_position_source_mapping_id TEXT
    REFERENCES staffing_position_source_mappings(id) ON DELETE RESTRICT,
  source_a_r_day TEXT,
  normalized_source_topology TEXT NOT NULL
    CHECK (
      length(trim(normalized_source_topology)) > 0
      AND normalized_source_topology = trim(normalized_source_topology)
    ),
  disposition TEXT NOT NULL DEFAULT 'ambiguous_mapping'
    CHECK (disposition IN (
      'unchanged',
      'moved',
      'new_combination',
      'missing_vanished',
      'unknown_employee',
      'ambiguous_mapping'
    )),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('not_required', 'pending', 'approved', 'rejected')),
  reviewed_at INTEGER,
  reviewed_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  resolution_reason TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    review_status IN ('approved', 'rejected')
    OR (
      reviewed_at IS NULL
      AND reviewed_by_member_id IS NULL
      AND resolution_reason IS NULL
    )
  ),
  CHECK (
    review_status NOT IN ('approved', 'rejected')
    OR (
      reviewed_at IS NOT NULL
      AND reviewed_by_member_id IS NOT NULL
      AND resolution_reason IS NOT NULL
      AND length(trim(resolution_reason)) > 0
    )
  ),
  CHECK (
    disposition NOT IN ('moved', 'new_combination', 'missing_vanished')
    OR review_status <> 'not_required'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_import_rows_import_row_unique
  ON assignment_import_rows (import_id, source_row_number);
--> statement-breakpoint
CREATE INDEX idx_assignment_import_rows_disposition
  ON assignment_import_rows (import_id, disposition, review_status);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_import_rows_id_import_unique
  ON assignment_import_rows (id, import_id);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_import_rows_id_member_unique
  ON assignment_import_rows (id, resolved_member_id);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_import_rows_id_mapping_unique
  ON assignment_import_rows (id, staffing_position_source_mapping_id);
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_mapping_matches_import_context_insert
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN NEW.staffing_position_source_mapping_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM assignment_imports import_record
    JOIN staffing_position_source_mappings mapping
      ON mapping.id = NEW.staffing_position_source_mapping_id
    WHERE import_record.id = NEW.import_id
      AND mapping.source_system = import_record.source_system
      AND mapping.source_locator = NEW.normalized_source_topology
  )
BEGIN
  SELECT RAISE(ABORT, 'source mapping does not match import context');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_mapping_matches_import_context_update
BEFORE UPDATE OF import_id, staffing_position_source_mapping_id, normalized_source_topology
ON assignment_import_rows
FOR EACH ROW
WHEN NEW.staffing_position_source_mapping_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM assignment_imports import_record
    JOIN staffing_position_source_mappings mapping
      ON mapping.id = NEW.staffing_position_source_mapping_id
    WHERE import_record.id = NEW.import_id
      AND mapping.source_system = import_record.source_system
      AND mapping.source_locator = NEW.normalized_source_topology
  )
BEGIN
  SELECT RAISE(ABORT, 'source mapping does not match import context');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_no_replace_after_commit
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_import_rows existing_row
  JOIN assignment_imports import_record ON import_record.id = existing_row.import_id
  WHERE (
      existing_row.id = NEW.id
      OR (
        existing_row.import_id = NEW.import_id
        AND existing_row.source_row_number = NEW.source_row_number
      )
    )
    AND (
      import_record.status IN ('approved', 'committed', 'rejected')
      OR existing_row.review_status IN ('approved', 'rejected')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'committed import rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_no_insert_after_commit
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports import_record
  WHERE import_record.id = NEW.import_id
    AND import_record.status IN ('approved', 'committed', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'committed import rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_no_update_after_commit
BEFORE UPDATE ON assignment_import_rows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports import_record
  WHERE import_record.id = OLD.import_id
    AND import_record.status IN ('approved', 'committed', 'rejected')
)
OR EXISTS (
  SELECT 1 FROM assignment_imports import_record
  WHERE import_record.id = NEW.import_id
    AND import_record.status IN ('approved', 'committed', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'committed import rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_no_delete_after_commit
BEFORE DELETE ON assignment_import_rows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports import_record
  WHERE import_record.id = OLD.import_id
    AND import_record.status IN ('approved', 'committed', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'committed import rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_id_is_immutable
BEFORE UPDATE OF id ON assignment_import_rows
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'assignment import row identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_no_replace_target_after_finalization
BEFORE UPDATE ON assignment_import_rows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_import_rows existing_row
  JOIN assignment_imports import_record ON import_record.id = existing_row.import_id
  WHERE existing_row.id <> OLD.id
    AND (
      existing_row.id = NEW.id
      OR (
        existing_row.import_id = NEW.import_id
        AND existing_row.source_row_number = NEW.source_row_number
      )
    )
    AND (
      import_record.status IN ('approved', 'committed', 'rejected')
      OR existing_row.review_status IN ('approved', 'rejected')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'finalized assignment import rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_no_update_after_final_review
BEFORE UPDATE ON assignment_import_rows
FOR EACH ROW
WHEN OLD.review_status IN ('approved', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'human-reviewed import rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_no_delete_after_final_review
BEFORE DELETE ON assignment_import_rows
FOR EACH ROW
WHEN OLD.review_status IN ('approved', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'human-reviewed import rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_approval_requires_reconciled_rows
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'approved'
  AND EXISTS (
    SELECT 1
    FROM assignment_import_rows row_record
    WHERE row_record.import_id = NEW.id
      AND (
        row_record.disposition IN ('unknown_employee', 'ambiguous_mapping')
        OR (
          row_record.disposition IN ('moved', 'new_combination', 'missing_vanished')
          AND row_record.review_status NOT IN ('approved', 'rejected')
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has unresolved reconciliation rows');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_approval_requires_resolved_observation_context
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'approved'
  AND EXISTS (
    SELECT 1
    FROM assignment_import_rows row_record
    WHERE row_record.import_id = NEW.id
      AND row_record.disposition IN ('unchanged', 'moved', 'new_combination')
      AND (
        row_record.resolved_member_id IS NULL
        OR row_record.staffing_position_source_mapping_id IS NULL
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has an unresolved observable source row');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_approval_requires_mapping_context
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'approved'
  AND EXISTS (
    SELECT 1
    FROM assignment_import_rows row_record
    LEFT JOIN staffing_position_source_mappings mapping
      ON mapping.id = row_record.staffing_position_source_mapping_id
    WHERE row_record.import_id = NEW.id
      AND row_record.staffing_position_source_mapping_id IS NOT NULL
      AND (
        mapping.id IS NULL
        OR mapping.source_system <> NEW.source_system
        OR mapping.source_locator <> row_record.normalized_source_topology
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has a source mapping outside its context');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_approval_requires_exact_row_count
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'approved'
  AND NEW.input_row_count <> (
    SELECT COUNT(*) FROM assignment_import_rows row_record
    WHERE row_record.import_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import row count does not match reconciled rows');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_commit_requires_reconciled_rows
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'committed'
  AND EXISTS (
    SELECT 1
    FROM assignment_import_rows row_record
    WHERE row_record.import_id = NEW.id
      AND (
        row_record.disposition IN ('unknown_employee', 'ambiguous_mapping')
        OR (
          row_record.disposition IN ('moved', 'new_combination', 'missing_vanished')
          AND row_record.review_status NOT IN ('approved', 'rejected')
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has unresolved reconciliation rows');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_commit_requires_resolved_observation_context
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'committed'
  AND EXISTS (
    SELECT 1
    FROM assignment_import_rows row_record
    WHERE row_record.import_id = NEW.id
      AND row_record.disposition IN ('unchanged', 'moved', 'new_combination')
      AND (
        row_record.resolved_member_id IS NULL
        OR row_record.staffing_position_source_mapping_id IS NULL
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has an unresolved observable source row');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_commit_requires_mapping_context
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'committed'
  AND EXISTS (
    SELECT 1
    FROM assignment_import_rows row_record
    LEFT JOIN staffing_position_source_mappings mapping
      ON mapping.id = row_record.staffing_position_source_mapping_id
    WHERE row_record.import_id = NEW.id
      AND row_record.staffing_position_source_mapping_id IS NOT NULL
      AND (
        mapping.id IS NULL
        OR mapping.source_system <> NEW.source_system
        OR mapping.source_locator <> row_record.normalized_source_topology
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has a source mapping outside its context');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_commit_requires_exact_row_count
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'committed'
  AND NEW.input_row_count <> (
    SELECT COUNT(*) FROM assignment_import_rows row_record
    WHERE row_record.import_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import row count does not match reconciled rows');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_manifest_is_immutable
BEFORE UPDATE OF id, source_system, source_version, source_hash, input_row_count, created_at
ON assignment_imports
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'assignment import manifest is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_no_update_after_commit
BEFORE UPDATE ON assignment_imports
FOR EACH ROW
WHEN OLD.status = 'committed'
BEGIN
  SELECT RAISE(ABORT, 'committed import is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_no_delete_after_commit
BEFORE DELETE ON assignment_imports
FOR EACH ROW
WHEN OLD.status IN ('approved', 'committed', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'finalized import is immutable');
END;

-- Immutable source-backed evidence. This says what a particular source row
-- observed; it does not itself create or modify the authoritative assignment.
CREATE TABLE assignment_observations (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_import_id TEXT NOT NULL REFERENCES assignment_imports(id) ON DELETE RESTRICT,
  assignment_import_row_id TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  staffing_position_id TEXT NOT NULL REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  staffing_position_source_mapping_id TEXT NOT NULL,
  source_a_r_day TEXT,
  normalized_source_topology TEXT NOT NULL CHECK (length(trim(normalized_source_topology)) > 0),
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (assignment_import_row_id, assignment_import_id)
    REFERENCES assignment_import_rows(id, import_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_import_row_id, member_id)
    REFERENCES assignment_import_rows(id, resolved_member_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_import_row_id, staffing_position_source_mapping_id)
    REFERENCES assignment_import_rows(id, staffing_position_source_mapping_id) ON DELETE RESTRICT,
  FOREIGN KEY (staffing_position_source_mapping_id, staffing_position_id)
    REFERENCES staffing_position_source_mappings(id, staffing_position_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_observations_import_row_unique
  ON assignment_observations (assignment_import_row_id);
--> statement-breakpoint
CREATE INDEX idx_assignment_observations_member_observed
  ON assignment_observations (member_id, observed_at);
--> statement-breakpoint
CREATE INDEX idx_assignment_observations_position_observed
  ON assignment_observations (staffing_position_id, observed_at);
--> statement-breakpoint
CREATE TRIGGER assignment_observations_no_replace
BEFORE INSERT ON assignment_observations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_observations existing
  WHERE existing.id = NEW.id
    OR existing.assignment_import_row_id = NEW.assignment_import_row_id
)
BEGIN
  SELECT RAISE(ABORT, 'assignment observations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_observations_require_committed_resolved_source
BEFORE INSERT ON assignment_observations
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM assignment_imports import_record
  JOIN assignment_import_rows row_record
    ON row_record.id = NEW.assignment_import_row_id
    AND row_record.import_id = NEW.assignment_import_id
  JOIN staffing_position_source_mappings mapping
    ON mapping.id = NEW.staffing_position_source_mapping_id
    AND mapping.staffing_position_id = NEW.staffing_position_id
  WHERE import_record.id = NEW.assignment_import_id
    AND import_record.status = 'committed'
    AND row_record.resolved_member_id = NEW.member_id
    AND row_record.staffing_position_source_mapping_id = NEW.staffing_position_source_mapping_id
    AND row_record.source_a_r_day IS NEW.source_a_r_day
    AND row_record.normalized_source_topology = NEW.normalized_source_topology
    AND mapping.source_system = import_record.source_system
    AND mapping.source_locator = row_record.normalized_source_topology
    AND (
      (row_record.disposition = 'unchanged' AND row_record.review_status = 'not_required')
      OR (
        row_record.disposition IN ('moved', 'new_combination')
        AND row_record.review_status = 'approved'
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'observation requires a committed resolved source row');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_observations_immutable_update
BEFORE UPDATE ON assignment_observations
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'assignment observations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_observations_immutable_delete
BEFORE DELETE ON assignment_observations
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'assignment observations are immutable');
END;

-- MBFD Bid's authoritative effective-dated assignment model. An assignment
-- may originate from an approved future bid before it exists in TeleStaff.
CREATE TABLE member_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  staffing_position_id TEXT NOT NULL REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  origin_type TEXT NOT NULL CHECK (origin_type IN (
    'TELESTAFF_IMPORT',
    'BID_AWARD',
    'MID_CYCLE_VACANCY',
    'ADMIN_TRANSFER',
    'PROMOTION',
    'CORRECTION'
  )),
  origin_ref TEXT NOT NULL CHECK (length(trim(origin_ref)) > 0),
  source_observation_id TEXT REFERENCES assignment_observations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'superseded', 'cancelled', 'ended')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    length(effective_from) = 10
    AND strftime('%Y-%m-%d', effective_from) IS NOT NULL
    AND strftime('%Y-%m-%d', effective_from) = effective_from
  ),
  CHECK (
    effective_to IS NULL
    OR (
      length(effective_to) = 10
      AND strftime('%Y-%m-%d', effective_to) IS NOT NULL
      AND strftime('%Y-%m-%d', effective_to) = effective_to
    )
  ),
  CHECK (effective_to IS NULL OR effective_from <= effective_to)
);
--> statement-breakpoint
CREATE INDEX idx_member_assignments_member_effective
  ON member_assignments (member_id, effective_from);
--> statement-breakpoint
CREATE INDEX idx_member_assignments_position_effective
  ON member_assignments (staffing_position_id, effective_from);
--> statement-breakpoint
CREATE UNIQUE INDEX member_assignments_source_observation_unique
  ON member_assignments (source_observation_id);
--> statement-breakpoint
CREATE TRIGGER member_assignments_require_authorized_slot_insert
BEFORE INSERT ON member_assignments
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM staffing_positions position
  WHERE position.id = NEW.staffing_position_id
    AND position.review_status IN ('approved', 'retired')
    AND (position.active_from IS NULL OR position.active_from <= NEW.effective_from)
    AND (
      position.active_to IS NULL
      OR (
        NEW.effective_to IS NOT NULL
        AND NEW.effective_to <= position.active_to
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'authoritative assignment requires an authorized active slot');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_require_authorized_slot_update
BEFORE UPDATE OF staffing_position_id, effective_from, effective_to
ON member_assignments
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM staffing_positions position
  WHERE position.id = NEW.staffing_position_id
    AND position.review_status IN ('approved', 'retired')
    AND (position.active_from IS NULL OR position.active_from <= NEW.effective_from)
    AND (
      position.active_to IS NULL
      OR (
        NEW.effective_to IS NOT NULL
        AND NEW.effective_to <= position.active_to
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'authoritative assignment requires an authorized active slot');
END;
--> statement-breakpoint
-- A terminal historical record may remain after a slot is retired or its range
-- closes, but it cannot be reactivated unless the canonical slot is again valid.
CREATE TRIGGER member_assignments_activation_requires_authorized_slot
BEFORE UPDATE OF status ON member_assignments
FOR EACH ROW
WHEN NEW.status IN ('planned', 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM staffing_positions position
    WHERE position.id = NEW.staffing_position_id
      AND position.review_status IN ('approved', 'retired')
      AND (position.active_from IS NULL OR position.active_from <= NEW.effective_from)
      AND (
        position.active_to IS NULL
        OR (
          NEW.effective_to IS NOT NULL
          AND NEW.effective_to <= position.active_to
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'authoritative assignment requires an authorized active slot');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_require_source_observation_insert
BEFORE INSERT ON member_assignments
FOR EACH ROW
WHEN (
  NEW.origin_type = 'TELESTAFF_IMPORT'
  AND NOT EXISTS (
    SELECT 1
    FROM assignment_observations observation
    WHERE observation.id = NEW.source_observation_id
      AND observation.member_id = NEW.member_id
      AND observation.staffing_position_id = NEW.staffing_position_id
  )
)
OR (
  NEW.origin_type <> 'TELESTAFF_IMPORT'
  AND NEW.source_observation_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'authoritative assignment source observation does not match its origin');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_require_source_observation_update
BEFORE UPDATE OF origin_type, source_observation_id, member_id, staffing_position_id
ON member_assignments
FOR EACH ROW
WHEN (
  NEW.origin_type = 'TELESTAFF_IMPORT'
  AND NOT EXISTS (
    SELECT 1
    FROM assignment_observations observation
    WHERE observation.id = NEW.source_observation_id
      AND observation.member_id = NEW.member_id
      AND observation.staffing_position_id = NEW.staffing_position_id
  )
)
OR (
  NEW.origin_type <> 'TELESTAFF_IMPORT'
  AND NEW.source_observation_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'authoritative assignment source observation does not match its origin');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_id_immutable
BEFORE UPDATE OF id ON member_assignments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'authoritative assignment identity is immutable');
END;
--> statement-breakpoint
-- A materialized source observation is evidence, not a mutable label. End or
-- supersede it, then add a new correction, rather than rewriting its lineage.
CREATE TRIGGER member_assignments_import_materialization_immutable
BEFORE UPDATE OF origin_type, origin_ref, member_id, staffing_position_id, source_observation_id, effective_from
ON member_assignments
FOR EACH ROW
WHEN OLD.origin_type = 'TELESTAFF_IMPORT'
  OR NEW.origin_type = 'TELESTAFF_IMPORT'
BEGIN
  SELECT RAISE(ABORT, 'TeleStaff assignment materialization is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_import_materialization_no_delete
BEFORE DELETE ON member_assignments
FOR EACH ROW
WHEN OLD.origin_type = 'TELESTAFF_IMPORT'
BEGIN
  SELECT RAISE(ABORT, 'TeleStaff assignment materialization cannot be deleted');
END;
--> statement-breakpoint
-- SQLite REPLACE deletes an existing conflicting row before inserting the new
-- one. Guard the conflict target before that destructive behavior can occur.
CREATE TRIGGER member_assignments_no_conflict_replacement_of_import_materialization_insert
BEFORE INSERT ON member_assignments
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM member_assignments existing
  WHERE existing.origin_type = 'TELESTAFF_IMPORT'
    AND (
      existing.id = NEW.id
      OR (
        NEW.source_observation_id IS NOT NULL
        AND existing.source_observation_id = NEW.source_observation_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'cannot replace a TeleStaff assignment materialization');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_no_conflict_replacement_of_import_materialization_update
BEFORE UPDATE ON member_assignments
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM member_assignments existing
  WHERE existing.id <> OLD.id
    AND existing.origin_type = 'TELESTAFF_IMPORT'
    AND (
      existing.id = NEW.id
      OR (
        NEW.source_observation_id IS NOT NULL
        AND existing.source_observation_id = NEW.source_observation_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'cannot replace a TeleStaff assignment materialization');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_no_overlapping_slot_insert
BEFORE INSERT ON member_assignments
FOR EACH ROW
WHEN NEW.status IN ('planned', 'active')
  AND EXISTS (
    SELECT 1
    FROM member_assignments existing
    WHERE existing.staffing_position_id = NEW.staffing_position_id
      AND existing.status IN ('planned', 'active')
      AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
      AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
  )
BEGIN
  SELECT RAISE(ABORT, 'overlapping authoritative assignment for canonical slot');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_no_overlapping_slot_update
BEFORE UPDATE OF staffing_position_id, status, effective_from, effective_to ON member_assignments
FOR EACH ROW
WHEN NEW.status IN ('planned', 'active')
  AND EXISTS (
    SELECT 1
    FROM member_assignments existing
    WHERE existing.id <> NEW.id
      AND existing.staffing_position_id = NEW.staffing_position_id
      AND existing.status IN ('planned', 'active')
      AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
      AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
  )
BEGIN
  SELECT RAISE(ABORT, 'overlapping authoritative assignment for canonical slot');
END;
