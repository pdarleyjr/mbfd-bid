-- Later approved ledger observations are separate immutable evidence. The
-- original year-unique cutoff capture and all pinned sessions stay intact.
CREATE TABLE bid_evidence_reviewed_updates (
 id TEXT PRIMARY KEY NOT NULL,
 bid_year INTEGER NOT NULL REFERENCES bid_years(year) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind='APPROVED_LEDGER_UPDATE'),
 original_freeze_id TEXT NOT NULL REFERENCES bid_evidence_freezes(id) ON DELETE RESTRICT,
 cutoff_at TEXT NOT NULL CHECK(cutoff_at='2026-09-30T17:00:00-04:00'),
 time_zone TEXT NOT NULL CHECK(time_zone='America/New_York'),
 captured_at INTEGER NOT NULL CHECK(typeof(captured_at)='integer' AND captured_at>=1790802000000),
 actor_subject TEXT NOT NULL CHECK(length(actor_subject)>0),
 reason TEXT NOT NULL CHECK(length(reason)>=4 AND length(reason)<=1000),
 source_version_id TEXT NOT NULL REFERENCES bid_definition_versions(id) ON DELETE RESTRICT,
 source_version_sha256 TEXT NOT NULL CHECK(length(source_version_sha256)=64),
 source_token TEXT NOT NULL CHECK(length(source_token)=64),
 evaluation_json TEXT NOT NULL CHECK(json_valid(evaluation_json)),
 personnel_source_json TEXT NOT NULL CHECK(json_valid(personnel_source_json)),
 credential_source_json TEXT NOT NULL CHECK(json_valid(credential_source_json)),
 evaluation_sha256 TEXT NOT NULL CHECK(length(evaluation_sha256)=64),
 personnel_sha256 TEXT NOT NULL CHECK(length(personnel_sha256)=64),
 credential_sha256 TEXT NOT NULL CHECK(length(credential_sha256)=64),
 source_imports_json TEXT NOT NULL CHECK(json_valid(source_imports_json)),
 provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
 idempotency_key TEXT NOT NULL UNIQUE REFERENCES admin_configuration_receipts(idempotency_key) ON DELETE RESTRICT
);
CREATE INDEX bid_evidence_reviewed_updates_year ON bid_evidence_reviewed_updates(bid_year,captured_at);
CREATE TRIGGER bid_evidence_reviewed_updates_no_update BEFORE UPDATE ON bid_evidence_reviewed_updates
BEGIN SELECT RAISE(ABORT,'reviewed bid evidence is immutable'); END;
CREATE TRIGGER bid_evidence_reviewed_updates_no_delete BEFORE DELETE ON bid_evidence_reviewed_updates
BEGIN SELECT RAISE(ABORT,'reviewed bid evidence is immutable'); END;
CREATE TRIGGER bid_evidence_reviewed_updates_no_replace BEFORE INSERT ON bid_evidence_reviewed_updates
WHEN EXISTS(SELECT 1 FROM bid_evidence_reviewed_updates p WHERE p.id=NEW.id OR p.rowid=NEW.rowid)
 OR EXISTS(SELECT 1 FROM bid_evidence_freezes p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'reviewed bid evidence identity is immutable'); END;

-- Approved import receipts and pending holds live in these mutable tables.
-- Existing annual_source_revision covers normalized Department evidence;
-- this independent generation closes import-row/receipt races without
-- changing historical annual review revision behavior.
CREATE TABLE bid_reviewed_update_source_revision (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL CHECK(revision>=0)
);
INSERT INTO bid_reviewed_update_source_revision(id,revision) VALUES(1,0);
CREATE TRIGGER reviewed_update_import_insert AFTER INSERT ON targetsolutions_imports
BEGIN UPDATE bid_reviewed_update_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER reviewed_update_import_update AFTER UPDATE ON targetsolutions_imports
BEGIN UPDATE bid_reviewed_update_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER reviewed_update_import_delete AFTER DELETE ON targetsolutions_imports
BEGIN UPDATE bid_reviewed_update_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER reviewed_update_row_insert AFTER INSERT ON targetsolutions_rows
BEGIN UPDATE bid_reviewed_update_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER reviewed_update_row_update AFTER UPDATE ON targetsolutions_rows
BEGIN UPDATE bid_reviewed_update_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER reviewed_update_row_delete AFTER DELETE ON targetsolutions_rows
BEGIN UPDATE bid_reviewed_update_source_revision SET revision=revision+1 WHERE id=1; END;
