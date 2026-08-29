-- Keep the confirmed TeleStaff source observation time distinct from both the
-- operator's import/apply time and the canonical assignment effective date.
-- A known HTML export may only establish a calendar date; it must never be
-- silently promoted to a fabricated timestamp.

ALTER TABLE assignment_imports
  ADD COLUMN source_observed_at INTEGER;
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN source_observation_time_basis TEXT NOT NULL DEFAULT 'date_only'
    CHECK (source_observation_time_basis IN (
      'date_only',
      'source_metadata',
      'administrator_confirmed'
    ));
--> statement-breakpoint
ALTER TABLE assignment_observations
  ADD COLUMN source_observed_at INTEGER;
--> statement-breakpoint

-- The temporal provenance belongs to the immutable import manifest.
DROP TRIGGER IF EXISTS assignment_imports_manifest_is_immutable;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_manifest_is_immutable
BEFORE UPDATE OF id, source_system, source_version, source_hash, source_format,
  parser_version, source_kind, input_row_count, normalized_data_row_count, unique_employee_count,
  report_row_count, structural_row_count, source_snapshot_as_of, source_observed_at,
  source_observation_time_basis, created_at
ON assignment_imports
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'assignment import manifest is immutable');
END;
--> statement-breakpoint

-- An exact timestamp is valid only when its basis is explicit. Conversely,
-- date-only evidence must remain time-null rather than use midnight or the
-- upload time as a made-up source observation.
CREATE TRIGGER assignment_imports_source_observation_time_consistent_insert
BEFORE INSERT ON assignment_imports
FOR EACH ROW
WHEN NOT (
  (NEW.source_observed_at IS NULL AND NEW.source_observation_time_basis = 'date_only')
  OR (
    NEW.source_observed_at IS NOT NULL
    AND NEW.source_observation_time_basis IN ('source_metadata', 'administrator_confirmed')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'source observation time and basis must agree');
END;
--> statement-breakpoint

CREATE TRIGGER assignment_observations_source_time_matches_import
BEFORE INSERT ON assignment_observations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_imports import_record
  WHERE import_record.id = NEW.assignment_import_id
    AND NEW.source_observed_at IS NOT import_record.source_observed_at
)
BEGIN
  SELECT RAISE(ABORT, 'assignment observation source time must match import manifest');
END;
