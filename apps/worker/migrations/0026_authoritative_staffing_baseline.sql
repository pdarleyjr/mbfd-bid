-- MBFD Bid V2 authoritative TeleStaff source-accounting baseline.
--
-- Forward-only: this adds provenance and an explicit annual designation without
-- reinterpreting or mutating historical import rows. Raw HTML, names, and Emp
-- IDs are intentionally absent; source identities remain keyed HMAC values.

ALTER TABLE assignment_imports
  ADD COLUMN source_format TEXT;
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN parser_version TEXT;
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'legacy_unclassified'
    CHECK (source_kind IN ('official', 'synthetic_test', 'legacy_unclassified'));
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN normalized_data_row_count INTEGER;
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN unique_employee_count INTEGER;
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN report_row_count INTEGER NOT NULL DEFAULT 0 CHECK (report_row_count >= 0);
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN structural_row_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE assignment_imports
  ADD COLUMN source_snapshot_as_of TEXT;
--> statement-breakpoint

ALTER TABLE assignment_import_rows
  ADD COLUMN source_topology_completeness TEXT NOT NULL DEFAULT 'complete'
    CHECK (source_topology_completeness IN ('complete', 'incomplete'));
--> statement-breakpoint

-- A source row cannot be silently collapsed by a duplicate payload fingerprint
-- or a duplicate opaque employee identity within the same source artifact.
CREATE UNIQUE INDEX assignment_import_rows_import_fingerprint_unique
  ON assignment_import_rows (import_id, row_fingerprint);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_import_rows_import_member_reference_hmac_unique
  ON assignment_import_rows (import_id, member_reference_hmac)
  WHERE member_reference_hmac IS NOT NULL;
--> statement-breakpoint

-- 0021's manifest trigger predates source-format provenance. Recreate it to
-- make every new accounting field immutable from the moment an import exists.
DROP TRIGGER IF EXISTS assignment_imports_manifest_is_immutable;
--> statement-breakpoint
CREATE TRIGGER assignment_imports_manifest_is_immutable
BEFORE UPDATE OF id, source_system, source_version, source_hash, source_format,
  parser_version, source_kind, input_row_count, normalized_data_row_count, unique_employee_count,
  report_row_count, structural_row_count, source_snapshot_as_of, created_at
ON assignment_imports
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'assignment import manifest is immutable');
END;
--> statement-breakpoint

-- The HTML adapter writes a self-consistent report manifest at staging time.
-- `source_snapshot_as_of` is optional because the known report does not carry
-- an authoritative effective/as-of date; when supplied it must be explicit.
CREATE TRIGGER assignment_imports_html_manifest_is_valid_on_insert
BEFORE INSERT ON assignment_imports
FOR EACH ROW
WHEN NEW.source_format = 'TELSTAFF_ASSIGNMENTS_HTML_V1'
  AND (
    NEW.source_kind NOT IN ('official', 'synthetic_test')
    OR NEW.parser_version IS NULL
    OR length(trim(NEW.parser_version, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) = 0
    OR NEW.normalized_data_row_count IS NULL
    OR NEW.unique_employee_count IS NULL
    OR NEW.input_row_count <= 0
    OR NEW.input_row_count <> NEW.normalized_data_row_count
    OR NEW.structural_row_count < 0
    OR NEW.report_row_count <> NEW.normalized_data_row_count + NEW.structural_row_count
    OR (
      NEW.source_snapshot_as_of IS NOT NULL
      AND NOT (
        length(NEW.source_snapshot_as_of) = 10
        AND strftime('%Y-%m-%d', NEW.source_snapshot_as_of) IS NOT NULL
        AND strftime('%Y-%m-%d', NEW.source_snapshot_as_of) = NEW.source_snapshot_as_of
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid TeleStaff HTML source manifest');
END;
--> statement-breakpoint

-- An incomplete source topology is source evidence only. It cannot claim a
-- canonical mapping or be materialized as an observation until a later,
-- separately imported complete source row is reconciled.
CREATE TRIGGER assignment_import_rows_incomplete_topology_has_no_mapping_insert
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN NEW.source_topology_completeness = 'incomplete'
  AND NEW.staffing_position_source_mapping_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'incomplete source topology cannot claim a canonical mapping');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_incomplete_topology_has_no_mapping_update
BEFORE UPDATE OF source_topology_completeness, staffing_position_source_mapping_id
ON assignment_import_rows
FOR EACH ROW
WHEN NEW.source_topology_completeness = 'incomplete'
  AND NEW.staffing_position_source_mapping_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'incomplete source topology cannot claim a canonical mapping');
END;
--> statement-breakpoint

-- Synthetic fixtures are source-format test evidence only. They cannot be
-- connected to MBFD canonical mappings or projected into observations, so they
-- cannot influence an official roster, portal work, or annual publication.
CREATE TRIGGER assignment_import_rows_synthetic_source_has_no_mapping_insert
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN NEW.staffing_position_source_mapping_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM assignment_imports import_record
    WHERE import_record.id = NEW.import_id
      AND import_record.source_kind = 'synthetic_test'
  )
BEGIN
  SELECT RAISE(ABORT, 'synthetic source evidence cannot claim a canonical mapping');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_synthetic_source_has_no_mapping_update
BEFORE UPDATE OF import_id, staffing_position_source_mapping_id ON assignment_import_rows
FOR EACH ROW
WHEN NEW.staffing_position_source_mapping_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM assignment_imports import_record
    WHERE import_record.id = NEW.import_id
      AND import_record.source_kind = 'synthetic_test'
  )
BEGIN
  SELECT RAISE(ABORT, 'synthetic source evidence cannot claim a canonical mapping');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_observations_reject_synthetic_source
BEFORE INSERT ON assignment_observations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports import_record
  WHERE import_record.id = NEW.assignment_import_id
    AND import_record.source_kind = 'synthetic_test'
)
BEGIN
  SELECT RAISE(ABORT, 'synthetic source evidence cannot materialize an observation');
END;
--> statement-breakpoint

-- HTML topology is versioned source evidence, not a hand-built locator. A
-- complete row contains all source topology fields; incomplete rows preserve
-- explicit nulls so they remain reviewable rather than silently invented.
CREATE TRIGGER assignment_import_rows_html_topology_is_valid_on_insert
BEFORE INSERT ON assignment_import_rows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports import_record
  WHERE import_record.id = NEW.import_id
    AND import_record.source_format = 'TELSTAFF_ASSIGNMENTS_HTML_V1'
)
AND (
  CASE WHEN json_valid(NEW.normalized_source_topology) = 1 THEN
    CASE WHEN
      NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.normalized_source_topology)
        WHERE key IN ('v', 'shift', 'division', 'station', 'unit', 'position')
        GROUP BY key
        HAVING COUNT(*) > 1
      )
      AND
      json_type(NEW.normalized_source_topology, '$.v') IN ('integer', 'real')
      AND json_extract(NEW.normalized_source_topology, '$.v') = 1
      AND json_type(NEW.normalized_source_topology, '$.shift') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.division') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.station') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.unit') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.position') IN ('text', 'null')
      AND (
        (NEW.source_topology_completeness = 'complete'
          AND json_type(NEW.normalized_source_topology, '$.shift') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.division') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.station') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.unit') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.position') = 'text'
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.shift'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.division'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.station'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.unit'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.position'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0)
        OR (NEW.source_topology_completeness = 'incomplete'
          AND (
            json_type(NEW.normalized_source_topology, '$.shift') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.division') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.station') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.unit') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.position') = 'null'
          ))
      )
    THEN 1 ELSE 0 END
  ELSE 0 END
) <> 1
BEGIN
  SELECT RAISE(ABORT, 'invalid versioned TeleStaff HTML source topology');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_html_topology_is_valid_on_update
BEFORE UPDATE OF import_id, normalized_source_topology, source_topology_completeness
ON assignment_import_rows
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports import_record
  WHERE import_record.id = NEW.import_id
    AND import_record.source_format = 'TELSTAFF_ASSIGNMENTS_HTML_V1'
)
AND (
  CASE WHEN json_valid(NEW.normalized_source_topology) = 1 THEN
    CASE WHEN
      NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.normalized_source_topology)
        WHERE key IN ('v', 'shift', 'division', 'station', 'unit', 'position')
        GROUP BY key
        HAVING COUNT(*) > 1
      )
      AND
      json_type(NEW.normalized_source_topology, '$.v') IN ('integer', 'real')
      AND json_extract(NEW.normalized_source_topology, '$.v') = 1
      AND json_type(NEW.normalized_source_topology, '$.shift') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.division') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.station') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.unit') IN ('text', 'null')
      AND json_type(NEW.normalized_source_topology, '$.position') IN ('text', 'null')
      AND (
        (NEW.source_topology_completeness = 'complete'
          AND json_type(NEW.normalized_source_topology, '$.shift') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.division') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.station') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.unit') = 'text'
          AND json_type(NEW.normalized_source_topology, '$.position') = 'text'
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.shift'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.division'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.station'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.unit'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
          AND length(trim(json_extract(NEW.normalized_source_topology, '$.position'), char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0)
        OR (NEW.source_topology_completeness = 'incomplete'
          AND (
            json_type(NEW.normalized_source_topology, '$.shift') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.division') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.station') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.unit') = 'null'
            OR json_type(NEW.normalized_source_topology, '$.position') = 'null'
          ))
      )
    THEN 1 ELSE 0 END
  ELSE 0 END
) <> 1
BEGIN
  SELECT RAISE(ABORT, 'invalid versioned TeleStaff HTML source topology');
END;
--> statement-breakpoint

-- Add the explicit incomplete-topology operator semantic while preserving the
-- old storage vocabulary. It is not a reinterpretation of historical NULL
-- classifications, and it has no auto-map or auto-observation action.
DROP TRIGGER IF EXISTS assignment_import_rows_v2_classification_matches_legacy_insert;
DROP TRIGGER IF EXISTS assignment_import_rows_v2_classification_matches_legacy_update;
DROP TRIGGER IF EXISTS assignment_import_rows_v2_final_action_is_compatible_insert;
DROP TRIGGER IF EXISTS assignment_import_rows_v2_final_action_is_compatible_update;
--> statement-breakpoint
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
    OR (
      NEW.reconciliation_classification = 'INCOMPLETE_TOPOLOGY'
      AND NEW.disposition = 'ambiguous_mapping'
      AND NEW.source_topology_completeness = 'incomplete'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 reconciliation classification for source row');
END;
--> statement-breakpoint
CREATE TRIGGER assignment_import_rows_v2_classification_matches_legacy_update
BEFORE UPDATE OF disposition, reconciliation_classification, source_topology_completeness
ON assignment_import_rows
FOR EACH ROW
WHEN NEW.reconciliation_classification IS NOT NULL
  AND NOT (
    (NEW.reconciliation_classification = 'UNCHANGED' AND NEW.disposition = 'unchanged')
    OR (NEW.reconciliation_classification = 'MOVED' AND NEW.disposition = 'moved')
    OR (NEW.reconciliation_classification = 'NEW_ASSIGNMENT' AND NEW.disposition = 'new_combination')
    OR (NEW.reconciliation_classification = 'NEW_POSITION' AND NEW.disposition = 'ambiguous_mapping')
    OR (NEW.reconciliation_classification = 'UNKNOWN_EMPLOYEE' AND NEW.disposition = 'unknown_employee')
    OR (NEW.reconciliation_classification = 'AMBIGUOUS_MAPPING' AND NEW.disposition = 'ambiguous_mapping')
    OR (
      NEW.reconciliation_classification = 'INCOMPLETE_TOPOLOGY'
      AND NEW.disposition = 'ambiguous_mapping'
      AND NEW.source_topology_completeness = 'incomplete'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid v2 reconciliation classification for source row');
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
      NEW.reconciliation_classification = 'INCOMPLETE_TOPOLOGY'
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'approved' AND NEW.resolution_action = 'RETAIN_UNMATERIALIZED_SOURCE_ROW')
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
BEFORE UPDATE OF reconciliation_classification, resolution_action, review_status,
  source_topology_completeness
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
      NEW.reconciliation_classification = 'INCOMPLETE_TOPOLOGY'
      AND NOT (
        (NEW.review_status = 'pending' AND NEW.resolution_action IS NULL)
        OR (NEW.review_status = 'approved' AND NEW.resolution_action = 'RETAIN_UNMATERIALIZED_SOURCE_ROW')
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

-- Unknown/ambiguous rows fail closed while pending. A final rejected source
-- row is immutable historical evidence, not a mapping or a fail-open pick.
DROP TRIGGER IF EXISTS assignment_imports_approval_requires_reconciled_rows;
DROP TRIGGER IF EXISTS assignment_imports_commit_requires_reconciled_rows;
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
          OR (
            row_record.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
            AND row_record.review_status <> 'rejected'
          )
          OR (
            row_record.reconciliation_classification IN (
              'MOVED', 'NEW_ASSIGNMENT', 'NEW_POSITION', 'INCOMPLETE_TOPOLOGY'
            )
            AND row_record.review_status NOT IN ('approved', 'rejected')
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM assignment_import_missing_observations finding
      WHERE finding.import_id = NEW.id AND finding.review_status <> 'resolved'
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
          OR (
            row_record.reconciliation_classification IN ('UNKNOWN_EMPLOYEE', 'AMBIGUOUS_MAPPING')
            AND row_record.review_status <> 'rejected'
          )
          OR (
            row_record.reconciliation_classification IN (
              'MOVED', 'NEW_ASSIGNMENT', 'NEW_POSITION', 'INCOMPLETE_TOPOLOGY'
            )
            AND row_record.review_status NOT IN ('approved', 'rejected')
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM assignment_import_missing_observations finding
      WHERE finding.import_id = NEW.id AND finding.review_status <> 'resolved'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment import has unresolved reconciliation rows');
END;
--> statement-breakpoint

-- Exactly one accepted, immutable source manifest is designated per Bid year.
-- A later source can only replace it by superseding this ledger row and
-- inserting a new accepted record; no import evidence is edited in place.
CREATE TABLE bid_year_staffing_baselines (
  id TEXT PRIMARY KEY NOT NULL,
  bid_year INTEGER NOT NULL REFERENCES bid_years(year) ON DELETE RESTRICT,
  assignment_import_id TEXT NOT NULL REFERENCES assignment_imports(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'superseded')),
  accepted_at INTEGER NOT NULL,
  accepted_by_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  acceptance_reason TEXT NOT NULL CHECK (length(trim(acceptance_reason)) > 0),
  superseded_at INTEGER,
  superseded_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  supersession_reason TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    (status = 'accepted'
      AND superseded_at IS NULL
      AND superseded_by_member_id IS NULL
      AND supersession_reason IS NULL)
    OR (
      status = 'superseded'
      AND superseded_at IS NOT NULL
      AND superseded_by_member_id IS NOT NULL
      AND supersession_reason IS NOT NULL
      AND length(trim(supersession_reason)) > 0
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX bid_year_staffing_baselines_one_accepted_per_year
  ON bid_year_staffing_baselines (bid_year)
  WHERE status = 'accepted';
--> statement-breakpoint
CREATE INDEX idx_bid_year_staffing_baselines_import
  ON bid_year_staffing_baselines (assignment_import_id, status);
--> statement-breakpoint
-- A source snapshot can establish one annual baseline only. Reusing it for a
-- later year would be an unsupported policy assertion, especially when the
-- report has no authoritative source-as-of date.
CREATE UNIQUE INDEX bid_year_staffing_baselines_one_year_per_import
  ON bid_year_staffing_baselines (assignment_import_id);
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_insert_requires_complete_official_manifest
BEFORE INSERT ON bid_year_staffing_baselines
FOR EACH ROW
WHEN NEW.status <> 'accepted'
  OR NOT EXISTS (
    SELECT 1 FROM assignment_imports import_record
    WHERE import_record.id = NEW.assignment_import_id
      AND import_record.status = 'committed'
      AND import_record.source_system = 'telestaff'
      AND import_record.source_kind = 'official'
      AND import_record.source_format IN (
        'TELSTAFF_ASSIGNMENTS_LEGACY_V1', 'TELSTAFF_ASSIGNMENTS_HTML_V1'
      )
      AND import_record.parser_version IS NOT NULL
      AND length(trim(import_record.parser_version, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
      AND length(import_record.source_hash) = 64
      AND import_record.source_hash NOT GLOB '*[^0-9a-f]*'
      AND import_record.input_row_count > 0
      AND import_record.normalized_data_row_count = import_record.input_row_count
      AND import_record.unique_employee_count = import_record.input_row_count
      AND import_record.structural_row_count >= 0
      AND import_record.report_row_count = (
        import_record.normalized_data_row_count + import_record.structural_row_count
      )
      AND (
        import_record.source_snapshot_as_of IS NULL
        OR (
          length(import_record.source_snapshot_as_of) = 10
          AND strftime('%Y-%m-%d', import_record.source_snapshot_as_of) IS NOT NULL
          AND strftime('%Y-%m-%d', import_record.source_snapshot_as_of) = import_record.source_snapshot_as_of
        )
      )
      AND import_record.input_row_count = (
        SELECT COUNT(*) FROM assignment_import_rows row_record
        WHERE row_record.import_id = import_record.id
      )
      AND import_record.input_row_count = (
        SELECT COUNT(DISTINCT row_record.source_row_number)
        FROM assignment_import_rows row_record
        WHERE row_record.import_id = import_record.id
      )
      AND import_record.input_row_count = (
        SELECT COUNT(DISTINCT row_record.row_fingerprint)
        FROM assignment_import_rows row_record
        WHERE row_record.import_id = import_record.id
      )
      AND import_record.input_row_count = (
        SELECT COUNT(DISTINCT row_record.member_reference_hmac)
        FROM assignment_import_rows row_record
        WHERE row_record.import_id = import_record.id
          AND row_record.member_reference_hmac IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM assignment_import_rows row_record
        WHERE row_record.import_id = import_record.id
          AND length(trim(row_record.normalized_source_topology, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) = 0
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'staffing baseline requires a complete official TeleStaff manifest');
END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_insert_requires_terminal_source_dispositions
BEFORE INSERT ON bid_year_staffing_baselines
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_import_rows row_record
  WHERE row_record.import_id = NEW.assignment_import_id
    AND (CASE WHEN (
      (row_record.reconciliation_classification = 'UNCHANGED'
        AND row_record.source_topology_completeness = 'complete'
        AND row_record.review_status = 'not_required'
        AND row_record.resolution_action IS NULL
        AND row_record.resolved_member_id IS NOT NULL
        AND row_record.staffing_position_source_mapping_id IS NOT NULL)
      OR (
        row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
        AND row_record.source_topology_completeness = 'complete'
        AND (
          (row_record.review_status = 'approved'
            AND row_record.resolution_action = 'APPLY_OBSERVATION'
            AND row_record.resolved_member_id IS NOT NULL
            AND row_record.staffing_position_source_mapping_id IS NOT NULL)
          OR (row_record.review_status = 'rejected'
            AND row_record.resolution_action = 'REJECT_SOURCE_ROW'
            AND row_record.staffing_position_source_mapping_id IS NULL)
        )
      )
      OR (
        row_record.reconciliation_classification = 'NEW_POSITION'
        AND row_record.source_topology_completeness = 'complete'
        AND (
          (row_record.review_status = 'approved'
            AND row_record.resolution_action = 'DEFER_NEW_POSITION'
            AND row_record.staffing_position_source_mapping_id IS NULL)
          OR (row_record.review_status = 'rejected'
            AND row_record.resolution_action = 'REJECT_SOURCE_ROW'
            AND row_record.staffing_position_source_mapping_id IS NULL)
        )
      )
      OR (
        row_record.reconciliation_classification = 'INCOMPLETE_TOPOLOGY'
        AND row_record.source_topology_completeness = 'incomplete'
        AND (
          (row_record.review_status = 'approved'
            AND row_record.resolution_action = 'RETAIN_UNMATERIALIZED_SOURCE_ROW')
          OR (row_record.review_status = 'rejected'
            AND row_record.resolution_action = 'REJECT_SOURCE_ROW')
        )
        AND row_record.staffing_position_source_mapping_id IS NULL
      )
      OR (
        (
          row_record.reconciliation_classification = 'UNKNOWN_EMPLOYEE'
          OR (
            row_record.reconciliation_classification = 'AMBIGUOUS_MAPPING'
            AND row_record.source_topology_completeness = 'complete'
          )
        )
        AND row_record.review_status = 'rejected'
        AND row_record.resolution_action = 'REJECT_SOURCE_ROW'
        AND row_record.staffing_position_source_mapping_id IS NULL
      )
    ) THEN 1 ELSE 0 END) <> 1
)
OR EXISTS (
  SELECT 1 FROM assignment_import_missing_observations finding
  WHERE finding.import_id = NEW.assignment_import_id
    AND finding.review_status <> 'resolved'
)
BEGIN
  SELECT RAISE(ABORT, 'staffing baseline requires terminal source reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_insert_requires_required_projection
BEFORE INSERT ON bid_year_staffing_baselines
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM assignment_import_rows row_record
  WHERE row_record.import_id = NEW.assignment_import_id
    AND (
      row_record.reconciliation_classification = 'UNCHANGED'
      OR (
        row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
        AND row_record.review_status = 'approved'
        AND row_record.resolution_action = 'APPLY_OBSERVATION'
      )
    )
    AND (
      (SELECT COUNT(*) FROM assignment_observations observation
       WHERE observation.assignment_import_id = NEW.assignment_import_id
         AND observation.assignment_import_row_id = row_record.id) <> 1
      OR (SELECT COUNT(*)
          FROM member_assignments assignment_record
          JOIN assignment_observations observation
            ON observation.id = assignment_record.source_observation_id
          JOIN staffing_positions position_record
            ON position_record.id = assignment_record.staffing_position_id
          WHERE observation.assignment_import_id = NEW.assignment_import_id
            AND observation.assignment_import_row_id = row_record.id
            AND assignment_record.origin_type = 'TELESTAFF_IMPORT'
            AND assignment_record.status = 'active'
            AND position_record.review_status = 'approved') <> 1
    )
)
OR EXISTS (
  SELECT 1
  FROM assignment_import_rows row_record
  WHERE row_record.import_id = NEW.assignment_import_id
    AND (CASE WHEN (
      row_record.reconciliation_classification = 'UNCHANGED'
      OR (
        row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
        AND row_record.review_status = 'approved'
        AND row_record.resolution_action = 'APPLY_OBSERVATION'
      )
    ) THEN 1 ELSE 0 END) <> 1
    AND EXISTS (
      SELECT 1 FROM assignment_observations observation
      WHERE observation.assignment_import_id = NEW.assignment_import_id
        AND observation.assignment_import_row_id = row_record.id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'staffing baseline requires complete source projection');
END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_identity_is_immutable
BEFORE UPDATE OF id, bid_year, assignment_import_id, accepted_at, accepted_by_member_id,
  acceptance_reason, created_at
ON bid_year_staffing_baselines
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'staffing baseline identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_only_allow_explicit_supersession
BEFORE UPDATE ON bid_year_staffing_baselines
FOR EACH ROW
WHEN NOT (
  OLD.status = 'accepted'
  AND NEW.status = 'superseded'
  AND NEW.superseded_at IS NOT NULL
  AND NEW.superseded_by_member_id IS NOT NULL
  AND NEW.supersession_reason IS NOT NULL
  AND length(trim(NEW.supersession_reason)) > 0
)
BEGIN
  SELECT RAISE(ABORT, 'staffing baseline records are immutable except explicit supersession');
END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_no_delete
BEFORE DELETE ON bid_year_staffing_baselines
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'staffing baseline history is immutable');
END;
