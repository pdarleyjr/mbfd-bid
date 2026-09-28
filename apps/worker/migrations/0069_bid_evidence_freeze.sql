-- One immutable 2026 eligibility capture. The JSON is private Department
-- evidence; public responses expose only hashes and source receipts.
CREATE TABLE bid_evidence_freezes (
 id TEXT PRIMARY KEY NOT NULL,
 bid_year INTEGER NOT NULL UNIQUE REFERENCES bid_years(year) ON DELETE RESTRICT,
 cutoff_at TEXT NOT NULL,
 time_zone TEXT NOT NULL CHECK(time_zone='America/New_York'),
 captured_at INTEGER NOT NULL CHECK(typeof(captured_at)='integer' AND captured_at>=0),
 actor_subject TEXT NOT NULL CHECK(length(actor_subject)>0),
 source_version_id TEXT NOT NULL REFERENCES bid_definition_versions(id) ON DELETE RESTRICT,
 source_version_sha256 TEXT NOT NULL CHECK(length(source_version_sha256)=64),
 source_token TEXT NOT NULL CHECK(length(source_token)=64),
 evaluation_json TEXT NOT NULL CHECK(json_valid(evaluation_json)),
 personnel_source_json TEXT NOT NULL CHECK(json_valid(personnel_source_json)),
 credential_source_json TEXT NOT NULL CHECK(json_valid(credential_source_json)),
 evaluation_sha256 TEXT NOT NULL CHECK(length(evaluation_sha256)=64),
 personnel_sha256 TEXT NOT NULL CHECK(length(personnel_sha256)=64),
 credential_sha256 TEXT NOT NULL CHECK(length(credential_sha256)=64),
 source_imports_json TEXT NOT NULL CHECK(json_valid(source_imports_json))
);
CREATE TRIGGER bid_evidence_freezes_no_update BEFORE UPDATE ON bid_evidence_freezes
BEGIN SELECT RAISE(ABORT,'bid evidence freeze is immutable'); END;
CREATE TRIGGER bid_evidence_freezes_no_delete BEFORE DELETE ON bid_evidence_freezes
BEGIN SELECT RAISE(ABORT,'bid evidence freeze is immutable'); END;
CREATE TRIGGER bid_evidence_freezes_no_replace BEFORE INSERT ON bid_evidence_freezes
WHEN EXISTS(SELECT 1 FROM bid_evidence_freezes prior WHERE prior.id=NEW.id
 OR prior.bid_year=NEW.bid_year OR prior.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid evidence freeze identity is immutable'); END;

-- Capture every relevant mutation between the approved instant and a sealed
-- freeze. The capture command refuses to certify a live read if a relevant
-- write occurred after 17:00. This is environment-neutral and leaves writes
-- available while retaining an explicit evidence trail.
CREATE TABLE bid_cutoff_mutations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 table_name TEXT NOT NULL,
 operation TEXT NOT NULL,
 occurred_at INTEGER NOT NULL
);
CREATE TRIGGER bid_cutoff_mutations_no_update BEFORE UPDATE ON bid_cutoff_mutations
BEGIN SELECT RAISE(ABORT,'bid cutoff mutation log is immutable'); END;
CREATE TRIGGER bid_cutoff_mutations_no_delete BEFORE DELETE ON bid_cutoff_mutations
BEGIN SELECT RAISE(ABORT,'bid cutoff mutation log is immutable'); END;
CREATE TRIGGER bid_cutoff_members_insert BEFORE INSERT ON members
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('members','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_members_update BEFORE UPDATE ON members
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('members','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_members_delete BEFORE DELETE ON members
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('members','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_credentials_insert BEFORE INSERT ON credentials
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('credentials','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_credentials_update BEFORE UPDATE ON credentials
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('credentials','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_credentials_delete BEFORE DELETE ON credentials
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('credentials','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_credential_catalog_metadata_insert BEFORE INSERT ON credential_catalog_metadata
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('credential_catalog_metadata','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_credential_catalog_metadata_update BEFORE UPDATE ON credential_catalog_metadata
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('credential_catalog_metadata','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_credential_catalog_metadata_delete BEFORE DELETE ON credential_catalog_metadata
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('credential_catalog_metadata','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_credentials_insert BEFORE INSERT ON member_credentials
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_credentials','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_credentials_update BEFORE UPDATE ON member_credentials
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_credentials','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_credentials_delete BEFORE DELETE ON member_credentials
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_credentials','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_qualification_events_insert BEFORE INSERT ON member_qualification_events
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_qualification_events','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_qualification_events_update BEFORE UPDATE ON member_qualification_events
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_qualification_events','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_qualification_events_delete BEFORE DELETE ON member_qualification_events
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_qualification_events','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_personnel_lifecycle_events_insert BEFORE INSERT ON personnel_lifecycle_events
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('personnel_lifecycle_events','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_personnel_lifecycle_events_update BEFORE UPDATE ON personnel_lifecycle_events
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('personnel_lifecycle_events','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_personnel_lifecycle_events_delete BEFORE DELETE ON personnel_lifecycle_events
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('personnel_lifecycle_events','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_service_evidence_insert BEFORE INSERT ON member_service_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_service_evidence','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_service_evidence_update BEFORE UPDATE ON member_service_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_service_evidence','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_service_evidence_delete BEFORE DELETE ON member_service_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_service_evidence','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_staffing_positions_insert BEFORE INSERT ON staffing_positions
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('staffing_positions','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_staffing_positions_update BEFORE UPDATE ON staffing_positions
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('staffing_positions','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_staffing_positions_delete BEFORE DELETE ON staffing_positions
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('staffing_positions','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_assignments_insert BEFORE INSERT ON member_assignments
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_assignments','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_assignments_update BEFORE UPDATE ON member_assignments
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_assignments','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_assignments_delete BEFORE DELETE ON member_assignments
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_assignments','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_imports_insert BEFORE INSERT ON assignment_imports
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_imports','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_imports_update BEFORE UPDATE ON assignment_imports
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_imports','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_imports_delete BEFORE DELETE ON assignment_imports
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_imports','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_import_rows_insert BEFORE INSERT ON assignment_import_rows
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_import_rows','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_import_rows_update BEFORE UPDATE ON assignment_import_rows
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_import_rows','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_import_rows_delete BEFORE DELETE ON assignment_import_rows
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_import_rows','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_observations_insert BEFORE INSERT ON assignment_observations
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_observations','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_observations_update BEFORE UPDATE ON assignment_observations
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_observations','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_observations_delete BEFORE DELETE ON assignment_observations
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_observations','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_import_missing_observations_insert BEFORE INSERT ON assignment_import_missing_observations
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_import_missing_observations','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_import_missing_observations_update BEFORE UPDATE ON assignment_import_missing_observations
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_import_missing_observations','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_assignment_import_missing_observations_delete BEFORE DELETE ON assignment_import_missing_observations
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('assignment_import_missing_observations','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_year_staffing_baselines_insert BEFORE INSERT ON bid_year_staffing_baselines
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_year_staffing_baselines','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_year_staffing_baselines_update BEFORE UPDATE ON bid_year_staffing_baselines
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_year_staffing_baselines','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_year_staffing_baselines_delete BEFORE DELETE ON bid_year_staffing_baselines
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_year_staffing_baselines','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_staffing_tenure_evidence_insert BEFORE INSERT ON staffing_tenure_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('staffing_tenure_evidence','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_staffing_tenure_evidence_update BEFORE UPDATE ON staffing_tenure_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('staffing_tenure_evidence','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_staffing_tenure_evidence_delete BEFORE DELETE ON staffing_tenure_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('staffing_tenure_evidence','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_targetsolutions_imports_insert BEFORE INSERT ON targetsolutions_imports
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('targetsolutions_imports','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_targetsolutions_imports_update BEFORE UPDATE ON targetsolutions_imports
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('targetsolutions_imports','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_targetsolutions_imports_delete BEFORE DELETE ON targetsolutions_imports
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('targetsolutions_imports','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_targetsolutions_rows_insert BEFORE INSERT ON targetsolutions_rows
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('targetsolutions_rows','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_targetsolutions_rows_update BEFORE UPDATE ON targetsolutions_rows
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('targetsolutions_rows','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_targetsolutions_rows_delete BEFORE DELETE ON targetsolutions_rows
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('targetsolutions_rows','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_ordinal_datasets_insert BEFORE INSERT ON bid_ordinal_datasets
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_ordinal_datasets','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_ordinal_datasets_update BEFORE UPDATE ON bid_ordinal_datasets
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_ordinal_datasets','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_ordinal_datasets_delete BEFORE DELETE ON bid_ordinal_datasets
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_ordinal_datasets','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_bid_tour_evidence_insert BEFORE INSERT ON member_bid_tour_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_bid_tour_evidence','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_bid_tour_evidence_update BEFORE UPDATE ON member_bid_tour_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_bid_tour_evidence','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_member_bid_tour_evidence_delete BEFORE DELETE ON member_bid_tour_evidence
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('member_bid_tour_evidence','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_definition_heads_insert BEFORE INSERT ON bid_definition_heads
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_definition_heads','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_definition_heads_update BEFORE UPDATE ON bid_definition_heads
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_definition_heads','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_definition_heads_delete BEFORE DELETE ON bid_definition_heads
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_definition_heads','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_definition_versions_insert BEFORE INSERT ON bid_definition_versions
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_definition_versions','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_definition_versions_update BEFORE UPDATE ON bid_definition_versions
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_definition_versions','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_definition_versions_delete BEFORE DELETE ON bid_definition_versions
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_definition_versions','DELETE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_years_insert BEFORE INSERT ON bid_years
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_years','INSERT',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_years_update BEFORE UPDATE ON bid_years
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_years','UPDATE',unixepoch('now')*1000); END;
CREATE TRIGGER bid_cutoff_bid_years_delete BEFORE DELETE ON bid_years
WHEN unixepoch('now')>=1790802000
 AND NOT EXISTS(SELECT 1 FROM bid_evidence_freezes WHERE bid_year=2026)
BEGIN INSERT INTO bid_cutoff_mutations(table_name,operation,occurred_at)
 VALUES('bid_years','DELETE',unixepoch('now')*1000); END;
