-- Split the 0026 monolithic manifest predicate into independently fail-closed
-- guards. This preserves the acceptance boundary while keeping every SQLite
-- expression below the schema-reparse depth limit. No table is altered.
DROP TRIGGER bid_year_staffing_baselines_insert_requires_complete_official_manifest;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_requires_official_committed_source
BEFORE INSERT ON bid_year_staffing_baselines FOR EACH ROW
WHEN NEW.status <> 'accepted' OR NOT EXISTS (
  SELECT 1 FROM assignment_imports i WHERE i.id = NEW.assignment_import_id
    AND i.status = 'committed' AND i.source_system = 'telestaff'
    AND i.source_kind = 'official'
    AND i.source_format IN ('TELSTAFF_ASSIGNMENTS_LEGACY_V1', 'TELSTAFF_ASSIGNMENTS_HTML_V1')
)
BEGIN SELECT RAISE(ABORT, 'staffing baseline requires a complete official TeleStaff manifest'); END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_requires_valid_manifest_metadata
BEFORE INSERT ON bid_year_staffing_baselines FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM assignment_imports i WHERE i.id = NEW.assignment_import_id
    AND i.parser_version IS NOT NULL
    AND length(trim(i.parser_version, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) > 0
    AND length(i.source_hash) = 64 AND i.source_hash NOT GLOB '*[^0-9a-f]*'
    AND i.input_row_count > 0 AND i.normalized_data_row_count = i.input_row_count
    AND i.unique_employee_count = i.input_row_count AND i.structural_row_count >= 0
    AND i.report_row_count = i.normalized_data_row_count + i.structural_row_count
    AND (i.source_snapshot_as_of IS NULL OR (length(i.source_snapshot_as_of) = 10
      AND strftime('%Y-%m-%d', i.source_snapshot_as_of) = i.source_snapshot_as_of))
)
BEGIN SELECT RAISE(ABORT, 'staffing baseline requires a complete official TeleStaff manifest'); END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_requires_complete_source_row_accounting
BEFORE INSERT ON bid_year_staffing_baselines FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_imports i WHERE i.id = NEW.assignment_import_id AND (
    i.input_row_count <> (SELECT COUNT(*) FROM assignment_import_rows r WHERE r.import_id = i.id)
    OR i.input_row_count <> (SELECT COUNT(DISTINCT r.source_row_number) FROM assignment_import_rows r WHERE r.import_id = i.id)
    OR i.input_row_count <> (SELECT COUNT(DISTINCT r.row_fingerprint) FROM assignment_import_rows r WHERE r.import_id = i.id)
    OR i.input_row_count <> (SELECT COUNT(DISTINCT r.member_reference_hmac) FROM assignment_import_rows r WHERE r.import_id = i.id AND r.member_reference_hmac IS NOT NULL)
  )
)
BEGIN SELECT RAISE(ABORT, 'staffing baseline requires a complete official TeleStaff manifest'); END;
--> statement-breakpoint
CREATE TRIGGER bid_year_staffing_baselines_requires_nonblank_source_topology
BEFORE INSERT ON bid_year_staffing_baselines FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM assignment_import_rows r WHERE r.import_id = NEW.assignment_import_id
    AND length(trim(r.normalized_source_topology, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))) = 0
)
BEGIN SELECT RAISE(ABORT, 'staffing baseline requires a complete official TeleStaff manifest'); END;
