-- Source imports are observations; only reviewed application writes affect the
-- existing immutable qualification ledger. No member identities are created.
CREATE TABLE targetsolutions_imports (
 id TEXT PRIMARY KEY, filename TEXT NOT NULL, observed_on TEXT NOT NULL,
 source_row_count INTEGER NOT NULL, unique_row_count INTEGER NOT NULL,
 coverage_json TEXT NOT NULL CHECK(json_valid(coverage_json)),
 status TEXT NOT NULL CHECK(status IN ('uploading','staged','reviewed')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE targetsolutions_mappings (
 source_key TEXT PRIMARY KEY, source_name TEXT NOT NULL,
 credential_id INTEGER REFERENCES credentials(id) ON DELETE RESTRICT,
 treatment TEXT NOT NULL CHECK(treatment IN ('qualification','reference_only')),
 reason TEXT NOT NULL, actor_subject TEXT NOT NULL, created_at INTEGER NOT NULL,
 CHECK((treatment='qualification' AND credential_id IS NOT NULL) OR (treatment='reference_only' AND credential_id IS NULL))
);
CREATE TABLE targetsolutions_rows (
 id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES targetsolutions_imports(id),
 row_number INTEGER NOT NULL, source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 member_id INTEGER REFERENCES members(id), credential_id INTEGER REFERENCES credentials(id),
 classification TEXT NOT NULL DEFAULT 'NOT_REVIEWED', before_json TEXT,
 reviewed_by TEXT, reviewed_at INTEGER,
 applied_event_id TEXT REFERENCES member_qualification_events(id),
 applied_at INTEGER, applied_by TEXT,
 UNIQUE(import_id,row_number)
);
CREATE INDEX targetsolutions_rows_import ON targetsolutions_rows(import_id,classification,applied_at);
CREATE INDEX targetsolutions_rows_member ON targetsolutions_rows(member_id,credential_id,classification);
CREATE TABLE targetsolutions_commands (
 id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES targetsolutions_imports(id),
 actor_subject TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
 revision_guard INTEGER NOT NULL CHECK(revision_guard=1)
);
CREATE TRIGGER targetsolutions_source_no_update BEFORE UPDATE OF source_json,import_id,row_number ON targetsolutions_rows
BEGIN SELECT RAISE(ABORT,'credential import source is immutable'); END;
CREATE TRIGGER targetsolutions_source_no_delete BEFORE DELETE ON targetsolutions_rows
BEGIN SELECT RAISE(ABORT,'credential import history cannot be deleted'); END;
CREATE TRIGGER targetsolutions_applied_no_update BEFORE UPDATE ON targetsolutions_rows WHEN OLD.applied_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'applied credential import evidence is immutable'); END;
CREATE TABLE targetsolutions_mapping_history (
 source_key TEXT NOT NULL, source_name TEXT NOT NULL, credential_id INTEGER, treatment TEXT NOT NULL,
 reason TEXT NOT NULL, actor_subject TEXT NOT NULL, created_at INTEGER NOT NULL, superseded_at INTEGER NOT NULL,
 PRIMARY KEY(source_key,created_at)
);
CREATE TRIGGER targetsolutions_mapping_preserve_history AFTER UPDATE ON targetsolutions_mappings
BEGIN
 INSERT INTO targetsolutions_mapping_history VALUES(OLD.source_key,OLD.source_name,OLD.credential_id,OLD.treatment,OLD.reason,OLD.actor_subject,OLD.created_at,NEW.created_at);
 UPDATE annual_source_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER targetsolutions_mapping_insert_revision AFTER INSERT ON targetsolutions_mappings
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER targetsolutions_mapping_history_no_update BEFORE UPDATE ON targetsolutions_mapping_history
BEGIN SELECT RAISE(ABORT,'mapping history is immutable'); END;
CREATE TRIGGER targetsolutions_mapping_history_no_delete BEFORE DELETE ON targetsolutions_mapping_history
BEGIN SELECT RAISE(ABORT,'mapping history is immutable'); END;
CREATE TRIGGER targetsolutions_mapping_no_delete BEFORE DELETE ON targetsolutions_mappings
BEGIN SELECT RAISE(ABORT,'approved credential mappings cannot be silently removed'); END;
-- A newly reviewed adverse observation invalidates unapproved preparation.
CREATE TRIGGER targetsolutions_dispute_invalidates_review AFTER UPDATE OF classification ON targetsolutions_rows
WHEN NEW.classification IS NOT OLD.classification AND
 (NEW.classification IN ('CONFLICT','EXPIRATION_REVIEW','REVOCATION_REVIEW') OR OLD.classification IN ('CONFLICT','EXPIRATION_REVIEW','REVOCATION_REVIEW'))
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER targetsolutions_dispute_resolution_invalidates_review AFTER UPDATE OF applied_at ON targetsolutions_rows
WHEN OLD.applied_at IS NULL AND NEW.applied_at IS NOT NULL AND OLD.classification IN ('CONFLICT','EXPIRATION_REVIEW','REVOCATION_REVIEW')
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;

CREATE TABLE targetsolutions_mapping_guards (id TEXT PRIMARY KEY, revision_guard INTEGER NOT NULL CHECK(revision_guard=1));
