-- A reviewed source-seat discriminator distinguishes legitimate repeated
-- TeleStaff topology (for example two Marine Float seats) without deriving a
-- canonical slot from a person, source-row order, or observed occupancy.

ALTER TABLE staffing_position_source_mappings
  ADD COLUMN source_discriminator TEXT NOT NULL DEFAULT 'primary'
    CHECK (
      length(trim(source_discriminator)) > 0
      AND source_discriminator = trim(source_discriminator)
    );
--> statement-breakpoint

DROP INDEX IF EXISTS staffing_position_source_mapping_locator_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX staffing_position_source_mapping_locator_unique
  ON staffing_position_source_mappings (
    source_system,
    source_locator,
    source_discriminator,
    effective_from
  );
--> statement-breakpoint

DROP TRIGGER IF EXISTS staffing_position_source_mappings_no_overlapping_scope_insert;
DROP TRIGGER IF EXISTS staffing_position_source_mappings_no_overlapping_scope_update;
DROP TRIGGER IF EXISTS staffing_position_source_mappings_no_replace_after_committed_reference;
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_no_overlapping_scope_insert
BEFORE INSERT ON staffing_position_source_mappings
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM staffing_position_source_mappings existing
  WHERE existing.source_system = NEW.source_system
    AND existing.source_locator = NEW.source_locator
    AND existing.source_discriminator = NEW.source_discriminator
    AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
    AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
)
BEGIN
  SELECT RAISE(ABORT, 'overlapping staffing source mapping scope');
END;
--> statement-breakpoint
CREATE TRIGGER staffing_position_source_mappings_no_overlapping_scope_update
BEFORE UPDATE OF source_system, source_locator, source_discriminator, effective_from, effective_to
ON staffing_position_source_mappings
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM staffing_position_source_mappings existing
  WHERE existing.id <> NEW.id
    AND existing.source_system = NEW.source_system
    AND existing.source_locator = NEW.source_locator
    AND existing.source_discriminator = NEW.source_discriminator
    AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
    AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
)
BEGIN
  SELECT RAISE(ABORT, 'overlapping staffing source mapping scope');
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
        AND existing.source_discriminator = NEW.source_discriminator
        AND existing.effective_from = NEW.effective_from
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'source mapping referenced by a committed import is immutable');
END;
