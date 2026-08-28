-- MBFD Bid V2 TeleStaff reconciliation contract.
--
-- This is deliberately forward-only. Existing legacy dispositions retain their
-- original meaning: no historical row is backfilled or guessed into the new
-- operator taxonomy.

ALTER TABLE assignment_imports
  ADD COLUMN reconciliation_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE assignment_import_rows
  ADD COLUMN reconciliation_classification TEXT;
--> statement-breakpoint

ALTER TABLE assignment_import_rows
  ADD COLUMN resolution_action TEXT;
--> statement-breakpoint

-- A missing source observation is negative evidence about an authoritative
-- assignment, not a fictional source row. Keeping it separate preserves the
-- source manifest's exact input-row accounting.
CREATE TABLE assignment_import_missing_observations (
  id TEXT PRIMARY KEY NOT NULL,
  import_id TEXT NOT NULL REFERENCES assignment_imports(id) ON DELETE RESTRICT,
  member_assignment_id TEXT NOT NULL REFERENCES member_assignments(id) ON DELETE RESTRICT,
  classification TEXT NOT NULL DEFAULT 'MISSING_OBSERVATION'
    CHECK (classification = 'MISSING_OBSERVATION'),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'resolved')),
  resolution_action TEXT
    CHECK (resolution_action IS NULL OR resolution_action IN ('RETAIN_ASSIGNMENT', 'END_ASSIGNMENT')),
  reviewed_at INTEGER,
  reviewed_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  resolution_reason TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    (review_status = 'pending'
      AND resolution_action IS NULL
      AND reviewed_at IS NULL
      AND reviewed_by_member_id IS NULL
      AND resolution_reason IS NULL)
    OR (
      review_status = 'resolved'
      AND resolution_action IN ('RETAIN_ASSIGNMENT', 'END_ASSIGNMENT')
      AND reviewed_at IS NOT NULL
      AND reviewed_by_member_id IS NOT NULL
      AND resolution_reason IS NOT NULL
      AND length(trim(resolution_reason)) > 0
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_import_missing_observations_import_assignment_unique
  ON assignment_import_missing_observations (import_id, member_assignment_id);
--> statement-breakpoint
CREATE INDEX idx_assignment_import_missing_observations_review
  ON assignment_import_missing_observations (import_id, review_status);
--> statement-breakpoint

CREATE TRIGGER assignment_import_missing_observations_no_insert_after_final_import
BEFORE INSERT ON assignment_import_missing_observations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_imports import_record
  WHERE import_record.id = NEW.import_id
    AND import_record.status IN ('approved', 'committed', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'finalized import findings are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_no_update_after_final_import
BEFORE UPDATE ON assignment_import_missing_observations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_imports import_record
  WHERE import_record.id IN (OLD.import_id, NEW.import_id)
    AND import_record.status IN ('approved', 'committed', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'finalized import findings are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_no_delete_after_final_import
BEFORE DELETE ON assignment_import_missing_observations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_imports import_record
  WHERE import_record.id = OLD.import_id
    AND import_record.status IN ('approved', 'committed', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'finalized import findings are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_no_update_after_resolution
BEFORE UPDATE ON assignment_import_missing_observations
FOR EACH ROW
WHEN OLD.review_status = 'resolved'
BEGIN
  SELECT RAISE(ABORT, 'resolved missing-observation findings are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_identity_is_immutable
BEFORE UPDATE OF id, import_id, member_assignment_id, classification, created_at
ON assignment_import_missing_observations
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'missing-observation finding identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_no_delete_after_resolution
BEFORE DELETE ON assignment_import_missing_observations
FOR EACH ROW
WHEN OLD.review_status = 'resolved'
BEGIN
  SELECT RAISE(ABORT, 'resolved missing-observation findings are immutable');
END;
--> statement-breakpoint

-- New classifications are tied to their legacy storage representation only for
-- rows created under this contract. Historical NULL classifications are left
-- untouched so `new_combination` is never retroactively reinterpreted.
CREATE TRIGGER assignment_import_rows_v2_classification_matches_legacy_insert
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN NEW.reconciliation_classification IS NOT NULL
  AND NOT (
    (NEW.reconciliation_classification = 'UNCHANGED' AND NEW.disposition = 'unchanged')
    OR (NEW.reconciliation_classification = 'MOVED' AND NEW.disposition = 'moved')
    OR (NEW.reconciliation_classification = 'NEW_ASSIGNMENT' AND NEW.disposition = 'new_combination')
    OR (NEW.reconciliation_classification = 'NEW_POSITION' AND NEW.disposition = 'ambiguous_mapping')
    OR (NEW.reconciliation_classification = 'UNKNOWN_EMPLOYEE' AND NEW.disposition = 'unknown_employee')
    OR (NEW.reconciliation_classification = 'AMBIGUOUS_MAPPING' AND NEW.disposition = 'ambiguous_mapping')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 reconciliation classification for source row');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_v2_classification_matches_legacy_update
BEFORE UPDATE OF disposition, reconciliation_classification ON assignment_import_rows
FOR EACH ROW
WHEN NEW.reconciliation_classification IS NOT NULL
  AND NOT (
    (NEW.reconciliation_classification = 'UNCHANGED' AND NEW.disposition = 'unchanged')
    OR (NEW.reconciliation_classification = 'MOVED' AND NEW.disposition = 'moved')
    OR (NEW.reconciliation_classification = 'NEW_ASSIGNMENT' AND NEW.disposition = 'new_combination')
    OR (NEW.reconciliation_classification = 'NEW_POSITION' AND NEW.disposition = 'ambiguous_mapping')
    OR (NEW.reconciliation_classification = 'UNKNOWN_EMPLOYEE' AND NEW.disposition = 'unknown_employee')
    OR (NEW.reconciliation_classification = 'AMBIGUOUS_MAPPING' AND NEW.disposition = 'ambiguous_mapping')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 reconciliation classification for source row');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_v2_action_requires_classification_insert
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN NEW.reconciliation_classification IS NULL
  AND NEW.resolution_action IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'v2 reconciliation action requires a v2 classification');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_v2_action_requires_classification_update
BEFORE UPDATE OF reconciliation_classification, resolution_action ON assignment_import_rows
FOR EACH ROW
WHEN NEW.reconciliation_classification IS NULL
  AND NEW.resolution_action IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'v2 reconciliation action requires a v2 classification');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_v2_final_action_is_compatible_insert
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN NEW.reconciliation_classification IS NOT NULL
  AND (
    (NEW.reconciliation_classification = 'UNCHANGED'
      AND (NEW.review_status <> 'not_required' OR NEW.resolution_action IS NOT NULL))
    OR (
      NEW.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'approved' AND NEW.resolution_action = 'APPLY_OBSERVATION')
        OR (NEW.review_status = 'rejected' AND NEW.resolution_action = 'REJECT_SOURCE_ROW')
      )
    )
    OR (
      NEW.reconciliation_classification = 'NEW_POSITION'
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'approved' AND NEW.resolution_action = 'DEFER_NEW_POSITION')
        OR (NEW.review_status = 'rejected' AND NEW.resolution_action = 'REJECT_SOURCE_ROW')
      )
    )
    OR (
      NEW.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'rejected' AND NEW.resolution_action = 'REJECT_SOURCE_ROW')
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 reconciliation review action');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_v2_final_action_is_compatible_update
BEFORE UPDATE OF reconciliation_classification, resolution_action, review_status
ON assignment_import_rows
FOR EACH ROW
WHEN NEW.reconciliation_classification IS NOT NULL
  AND (
    (NEW.reconciliation_classification = 'UNCHANGED'
      AND (NEW.review_status <> 'not_required' OR NEW.resolution_action IS NOT NULL))
    OR (
      NEW.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'approved' AND NEW.resolution_action = 'APPLY_OBSERVATION')
        OR (NEW.review_status = 'rejected' AND NEW.resolution_action = 'REJECT_SOURCE_ROW')
      )
    )
    OR (
      NEW.reconciliation_classification = 'NEW_POSITION'
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'approved' AND NEW.resolution_action = 'DEFER_NEW_POSITION')
        OR (NEW.review_status = 'rejected' AND NEW.resolution_action = 'REJECT_SOURCE_ROW')
      )
    )
    OR (
      NEW.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'rejected' AND NEW.resolution_action = 'REJECT_SOURCE_ROW')
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 reconciliation review action');
END;
--> statement-breakpoint

CREATE INDEX idx_assignment_import_rows_v2_reconciliation
  ON assignment_import_rows (import_id, reconciliation_classification, review_status);
--> statement-breakpoint

-- The revision is an optimistic-concurrency token for the future admin review
-- surface. It advances on reconciliation evidence, never on an import's
-- immutable source manifest.
CREATE TRIGGER assignment_import_rows_bump_reconciliation_revision_after_insert
AFTER INSERT ON assignment_import_rows
FOR EACH ROW
BEGIN
  UPDATE assignment_imports
  SET reconciliation_revision = reconciliation_revision + 1
  WHERE id = NEW.import_id;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_bump_reconciliation_revision_after_update
AFTER UPDATE OF reconciliation_classification, resolution_action, review_status,
  reviewed_at, reviewed_by_member_id, resolution_reason ON assignment_import_rows
FOR EACH ROW
BEGIN
  UPDATE assignment_imports
  SET reconciliation_revision = reconciliation_revision + 1
  WHERE id = NEW.import_id;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_bump_reconciliation_revision_after_delete
AFTER DELETE ON assignment_import_rows
FOR EACH ROW
BEGIN
  UPDATE assignment_imports
  SET reconciliation_revision = reconciliation_revision + 1
  WHERE id = OLD.import_id;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_bump_reconciliation_revision_after_insert
AFTER INSERT ON assignment_import_missing_observations
FOR EACH ROW
BEGIN
  UPDATE assignment_imports
  SET reconciliation_revision = reconciliation_revision + 1
  WHERE id = NEW.import_id;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_bump_reconciliation_revision_after_update
AFTER UPDATE OF review_status, resolution_action, reviewed_at, reviewed_by_member_id,
  resolution_reason ON assignment_import_missing_observations
FOR EACH ROW
BEGIN
  UPDATE assignment_imports
  SET reconciliation_revision = reconciliation_revision + 1
  WHERE id = NEW.import_id;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_missing_observations_bump_reconciliation_revision_after_delete
AFTER DELETE ON assignment_import_missing_observations
FOR EACH ROW
BEGIN
  UPDATE assignment_imports
  SET reconciliation_revision = reconciliation_revision + 1
  WHERE id = OLD.import_id;
END;
--> statement-breakpoint

-- The original 0021 checks remain in force for legacy NULL classifications.
-- V2 rows add action-aware gates; rejected unknown/ambiguous evidence remains
-- an approval and commit blocker, never a fail-open outcome.
DROP TRIGGER IF EXISTS assignment_imports_approval_requires_reconciled_rows;
DROP TRIGGER IF EXISTS assignment_imports_commit_requires_reconciled_rows;
DROP TRIGGER IF EXISTS assignment_imports_approval_requires_resolved_observation_context;
DROP TRIGGER IF EXISTS assignment_imports_commit_requires_resolved_observation_context;
DROP TRIGGER IF EXISTS assignment_observations_require_committed_resolved_source;
--> statement-breakpoint

CREATE TRIGGER assignment_imports_approval_requires_reconciled_rows
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'approved'
  AND (
    EXISTS (
      SELECT 1
      FROM assignment_import_rows row_record
      WHERE row_record.import_id = NEW.id
        AND (
          (
            row_record.reconciliation_classification IS NULL
            AND (
              row_record.disposition IN ('unknown_employee', 'ambiguous_mapping')
              OR (
                row_record.disposition IN ('moved', 'new_combination', 'missing_vanished')
                AND row_record.review_status NOT IN ('approved', 'rejected')
              )
            )
          )
          OR row_record.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
          OR (
            row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT', 'NEW_POSITION')
            AND row_record.review_status NOT IN ('approved', 'rejected')
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM assignment_import_missing_observations finding
      WHERE finding.import_id = NEW.id
        AND finding.review_status <> 'resolved'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has unresolved reconciliation rows');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_commit_requires_reconciled_rows
BEFORE UPDATE OF status ON assignment_imports
FOR EACH ROW
WHEN NEW.status = 'committed'
  AND (
    EXISTS (
      SELECT 1
      FROM assignment_import_rows row_record
      WHERE row_record.import_id = NEW.id
        AND (
          (
            row_record.reconciliation_classification IS NULL
            AND (
              row_record.disposition IN ('unknown_employee', 'ambiguous_mapping')
              OR (
                row_record.disposition IN ('moved', 'new_combination', 'missing_vanished')
                AND row_record.review_status NOT IN ('approved', 'rejected')
              )
            )
          )
          OR row_record.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
          OR (
            row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT', 'NEW_POSITION')
            AND row_record.review_status NOT IN ('approved', 'rejected')
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM assignment_import_missing_observations finding
      WHERE finding.import_id = NEW.id
        AND finding.review_status <> 'resolved'
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
      AND (
        (
          row_record.reconciliation_classification IS NULL
          AND row_record.disposition IN ('unchanged', 'moved', 'new_combination')
        )
        OR row_record.reconciliation_classification IN ('UNCHANGED', 'MOVED', 'NEW_ASSIGNMENT')
      )
      AND (
        row_record.resolved_member_id IS NULL
        OR row_record.staffing_position_source_mapping_id IS NULL
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has an unresolved observable source row');
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
      AND (
        (
          row_record.reconciliation_classification IS NULL
          AND row_record.disposition IN ('unchanged', 'moved', 'new_combination')
        )
        OR row_record.reconciliation_classification IN ('UNCHANGED', 'MOVED', 'NEW_ASSIGNMENT')
      )
      AND (
        row_record.resolved_member_id IS NULL
        OR row_record.staffing_position_source_mapping_id IS NULL
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has an unresolved observable source row');
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
      (
        row_record.reconciliation_classification IS NULL
        AND (
          (row_record.disposition = 'unchanged' AND row_record.review_status = 'not_required')
          OR (
            row_record.disposition IN ('moved', 'new_combination')
            AND row_record.review_status = 'approved'
          )
        )
      )
      OR (
        row_record.reconciliation_classification = 'UNCHANGED'
        AND row_record.disposition = 'unchanged'
        AND row_record.review_status = 'not_required'
      )
      OR (
        row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
        AND row_record.review_status = 'approved'
        AND row_record.resolution_action = 'APPLY_OBSERVATION'
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'observation requires a committed resolved source row');
END;
