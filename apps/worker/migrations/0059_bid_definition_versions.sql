-- Immutable Bid versions and their current pointer. No historical snapshot
-- is backfilled or labelled with inferred product-version provenance.
CREATE TABLE bid_definition_versions (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
 bid_year INTEGER NOT NULL REFERENCES bid_years(year) ON DELETE RESTRICT,
 version_number INTEGER NOT NULL CHECK(typeof(version_number)='integer' AND version_number>0),
 schema_version INTEGER NOT NULL CHECK(schema_version=1),
 content_json TEXT NOT NULL CHECK(json_valid(content_json) AND json_type(content_json)='object'
   AND json_type(content_json,'$.v') IS 'integer' AND json_extract(content_json,'$.v') IS schema_version
   AND json_type(content_json,'$.bidYear') IS 'integer' AND json_extract(content_json,'$.bidYear') IS bid_year),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*' AND instr(content_sha256,char(0))=0),
 origin_json TEXT NOT NULL CHECK(json_valid(origin_json) AND json_type(origin_json)='object'),
 rule_book_version TEXT NOT NULL UNIQUE REFERENCES rule_books(version) ON DELETE RESTRICT,
 rule_book_revision INTEGER NOT NULL CHECK(typeof(rule_book_revision)='integer' AND rule_book_revision>=0),
 position_template_version TEXT NOT NULL UNIQUE REFERENCES position_templates(version) ON DELETE RESTRICT,
 policy_document_id TEXT UNIQUE REFERENCES annual_bid_policy_documents(id) ON DELETE RESTRICT,
 predecessor_id TEXT,
 restored_from_id TEXT,
 actor_subject TEXT NOT NULL CHECK(length(actor_subject)>0),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=4),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
 UNIQUE(bid_year,version_number),
 UNIQUE(bid_year,id),
 FOREIGN KEY(bid_year,predecessor_id) REFERENCES bid_definition_versions(bid_year,id) ON DELETE RESTRICT,
 FOREIGN KEY(bid_year,restored_from_id) REFERENCES bid_definition_versions(bid_year,id) ON DELETE RESTRICT
);

CREATE TABLE bid_definition_heads (
 bid_year INTEGER PRIMARY KEY REFERENCES bid_years(year) ON DELETE RESTRICT,
 version_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
 FOREIGN KEY(bid_year,version_id) REFERENCES bid_definition_versions(bid_year,id) ON DELETE RESTRICT
);

CREATE TRIGGER bid_definition_versions_no_replace BEFORE INSERT ON bid_definition_versions
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rowid=NEW.rowid OR v.id=NEW.id
 OR (v.bid_year=NEW.bid_year AND v.version_number=NEW.version_number)
 OR v.rule_book_version=NEW.rule_book_version OR v.position_template_version=NEW.position_template_version
 OR (NEW.policy_document_id IS NOT NULL AND v.policy_document_id=NEW.policy_document_id))
BEGIN SELECT RAISE(ABORT,'bid version is immutable'); END;
CREATE TRIGGER bid_definition_versions_no_update BEFORE UPDATE ON bid_definition_versions
BEGIN SELECT RAISE(ABORT,'bid version is immutable'); END;
CREATE TRIGGER bid_definition_versions_no_delete BEFORE DELETE ON bid_definition_versions
BEGIN SELECT RAISE(ABORT,'bid version is immutable'); END;

CREATE TRIGGER bid_definition_versions_lineage BEFORE INSERT ON bid_definition_versions
WHEN (NEW.version_number=1 AND (NEW.predecessor_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM bid_definition_heads WHERE bid_year=NEW.bid_year)))
 OR (NEW.version_number>1 AND NOT EXISTS(
   SELECT 1 FROM bid_definition_heads h JOIN bid_definition_versions v ON v.id=h.version_id
   WHERE h.bid_year=NEW.bid_year AND h.version_id=NEW.predecessor_id
    AND v.version_number=NEW.version_number-1 AND h.revision=v.version_number))
 OR (NEW.restored_from_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM bid_definition_versions v WHERE v.bid_year=NEW.bid_year
    AND v.id=NEW.restored_from_id AND v.version_number<NEW.version_number))
BEGIN SELECT RAISE(ABORT,'bid version lineage is invalid'); END;

CREATE TRIGGER bid_definition_heads_no_replace BEFORE INSERT ON bid_definition_heads
WHEN EXISTS(SELECT 1 FROM bid_definition_heads WHERE bid_year=NEW.bid_year)
BEGIN SELECT RAISE(ABORT,'bid head cannot be replaced'); END;
CREATE TRIGGER bid_definition_heads_initial BEFORE INSERT ON bid_definition_heads
WHEN NEW.revision<>1 OR NOT EXISTS(SELECT 1 FROM bid_definition_versions v
 WHERE v.bid_year=NEW.bid_year AND v.id=NEW.version_id AND v.version_number=1 AND v.predecessor_id IS NULL)
BEGIN SELECT RAISE(ABORT,'initial bid head is invalid'); END;
CREATE TRIGGER bid_definition_heads_forward BEFORE UPDATE ON bid_definition_heads
WHEN NEW.bid_year<>OLD.bid_year OR NEW.revision<>OLD.revision+1
 OR NEW.version_id=OLD.version_id OR NOT EXISTS(SELECT 1 FROM bid_definition_versions v
  WHERE v.bid_year=NEW.bid_year AND v.id=NEW.version_id
   AND v.predecessor_id=OLD.version_id AND v.version_number=NEW.revision)
BEGIN SELECT RAISE(ABORT,'bid head must advance to a new successor'); END;
CREATE TRIGGER bid_definition_heads_no_delete BEFORE DELETE ON bid_definition_heads
BEGIN SELECT RAISE(ABORT,'bid head cannot be deleted'); END;

-- Version admission checks persisted identities and private material ownership.
-- Canonical schema/decoder validation, exact material comparison and SHA-256
-- remain application responsibilities; a SQL hash-format check is not a digest.
CREATE TRIGGER bid_definition_versions_backing_required BEFORE INSERT ON bid_definition_versions
WHEN NOT EXISTS(SELECT 1 FROM rule_books b WHERE b.version=NEW.rule_book_version
 AND b.effective_year=NEW.bid_year AND b.revision=NEW.rule_book_revision AND b.status='draft')
 OR NOT EXISTS(SELECT 1 FROM position_templates t WHERE t.version=NEW.position_template_version AND t.effective_year=NEW.bid_year)
 OR EXISTS(SELECT 1 FROM bid_years y WHERE y.rule_book_version=NEW.rule_book_version OR y.position_template_version=NEW.position_template_version)
 OR EXISTS(SELECT 1 FROM position_rules r WHERE (r.rule_book_version=NEW.rule_book_version AND r.template_version<>NEW.position_template_version)
  OR (r.template_version=NEW.position_template_version AND r.rule_book_version<>NEW.rule_book_version))
 OR EXISTS(SELECT 1 FROM position_rules r WHERE r.rule_book_version=NEW.rule_book_version
  GROUP BY r.position_id HAVING COUNT(*)>1)
 OR EXISTS(SELECT 1 FROM position_rules r WHERE r.rule_book_version=NEW.rule_book_version
  AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.template_version=NEW.position_template_version AND p.id=r.position_id))
 OR EXISTS(SELECT 1 FROM rule_book_position_participation p WHERE
  (p.rule_book_version=NEW.rule_book_version AND p.template_version<>NEW.position_template_version)
  OR (p.template_version=NEW.position_template_version AND p.rule_book_version<>NEW.rule_book_version))
 OR (NEW.policy_document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_bid_policy_documents p
  WHERE p.id=NEW.policy_document_id AND p.rule_book_version=NEW.rule_book_version AND p.effective_year=NEW.bid_year AND p.status='DRAFT'))
BEGIN SELECT RAISE(ABORT,'bid version backing material is invalid'); END;

-- Seal position_templates by permanent version ownership, never current-head status.
CREATE TRIGGER bid_version_position_templates_insert BEFORE INSERT ON position_templates
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.version)
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_position_templates_update BEFORE UPDATE ON position_templates
WHEN (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.version))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_position_templates_delete BEFORE DELETE ON position_templates
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.version)
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
-- Seal positions by permanent version ownership, never current-head status.
CREATE TRIGGER bid_version_positions_insert BEFORE INSERT ON positions
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version)
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_positions_update BEFORE UPDATE ON positions
WHEN (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_positions_delete BEFORE DELETE ON positions
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version)
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
-- Seal position_rules by permanent version ownership, never current-head status.
CREATE TRIGGER bid_version_position_rules_insert BEFORE INSERT ON position_rules
WHEN (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=NEW.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version) OR EXISTS(SELECT 1 FROM position_rules r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version OR v.position_template_version=r.template_version WHERE r.id=NEW.id))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_position_rules_update BEFORE UPDATE ON position_rules
WHEN ((EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version)) OR (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=NEW.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version) OR EXISTS(SELECT 1 FROM position_rules r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version OR v.position_template_version=r.template_version WHERE r.id=NEW.id)))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_position_rules_delete BEFORE DELETE ON position_rules
WHEN (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
-- Seal rule_book_position_participation by permanent version ownership, never current-head status.
CREATE TRIGGER bid_version_rule_book_position_participation_insert BEFORE INSERT ON rule_book_position_participation
WHEN (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=NEW.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_rule_book_position_participation_update BEFORE UPDATE ON rule_book_position_participation
WHEN ((EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version)) OR (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=NEW.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version)))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_rule_book_position_participation_delete BEFORE DELETE ON rule_book_position_participation
WHEN (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.rule_book_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
-- Seal position_staffing_bindings by permanent version ownership, never current-head status.
CREATE TRIGGER bid_version_position_staffing_bindings_insert BEFORE INSERT ON position_staffing_bindings
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version)
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_position_staffing_bindings_update BEFORE UPDATE ON position_staffing_bindings
WHEN (EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=NEW.template_version))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_position_staffing_bindings_delete BEFORE DELETE ON position_staffing_bindings
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.position_template_version=OLD.template_version)
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;

-- REPLACE can collide with the active-year index using a different book ID.
CREATE TRIGGER bid_version_book_insert BEFORE INSERT ON rule_books
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=NEW.version)
 OR (NEW.status='active' AND EXISTS(SELECT 1 FROM rule_books b JOIN bid_definition_versions v ON v.rule_book_version=b.version
  WHERE b.effective_year=NEW.effective_year AND b.status='active'))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_book_update BEFORE UPDATE ON rule_books
WHEN ((EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.version) OR EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=NEW.version))
 AND (NEW.version IS NOT OLD.version OR NEW.effective_year IS NOT OLD.effective_year
  OR NEW.notes IS NOT OLD.notes OR NEW.revision IS NOT OLD.revision OR NEW.status IS NOT OLD.status))
 OR (NEW.status='active' AND EXISTS(SELECT 1 FROM rule_books b JOIN bid_definition_versions v ON v.rule_book_version=b.version
  WHERE b.version<>OLD.version AND b.effective_year=NEW.effective_year AND b.status='active'))
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;
CREATE TRIGGER bid_version_book_delete BEFORE DELETE ON rule_books
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.version)
BEGIN SELECT RAISE(ABORT,'bid version material is immutable'); END;

CREATE TRIGGER bid_version_document_insert BEFORE INSERT ON annual_bid_policy_documents
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=NEW.rule_book_version)
 OR EXISTS(SELECT 1 FROM annual_bid_policy_documents p JOIN bid_definition_versions v ON v.rule_book_version=p.rule_book_version WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'bid version source is immutable'); END;
CREATE TRIGGER bid_version_document_delete BEFORE DELETE ON annual_bid_policy_documents
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.rule_book_version)
BEGIN SELECT RAISE(ABORT,'bid version source is immutable'); END;
-- A saved edit has no publication authority. Keep version-owned documents
-- sealed until the explicit version/context review lifecycle is integrated.
CREATE TRIGGER bid_version_document_update BEFORE UPDATE ON annual_bid_policy_documents
WHEN EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=OLD.rule_book_version OR v.rule_book_version=NEW.rule_book_version)
BEGIN SELECT RAISE(ABORT,'bid version source is immutable'); END;

-- Captured authoring and source-decision references keep their append-only
-- meaning under INSERT OR REPLACE, including recursive_triggers=OFF.
CREATE TRIGGER annual_rule_profile_revisions_no_replace BEFORE INSERT ON annual_rule_profile_revisions
WHEN EXISTS(SELECT 1 FROM annual_rule_profile_revisions WHERE rowid=NEW.rowid OR (bid_year=NEW.bid_year AND revision=NEW.revision))
BEGIN SELECT RAISE(ABORT,'annual rule profile history is immutable'); END;
CREATE TRIGGER bid_source_decisions_no_replace BEFORE INSERT ON bid_source_decisions
WHEN EXISTS(SELECT 1 FROM bid_source_decisions WHERE rowid=NEW.rowid OR (bid_year=NEW.bid_year AND issue_id=NEW.issue_id AND revision=NEW.revision))
BEGIN SELECT RAISE(ABORT,'source decision history is immutable'); END;

-- SQLite rowid is an additional conflict identity even on TEXT/composite
-- primary-key tables. Guard it before REPLACE can implicitly delete an owned
-- row when recursive_triggers is disabled. Rule numeric IDs are covered too.
CREATE TRIGGER bid_version_position_templates_rowid_insert BEFORE INSERT ON position_templates
WHEN EXISTS(SELECT 1 FROM position_templates r JOIN bid_definition_versions v ON v.position_template_version=r.version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_position_templates_rowid_update BEFORE UPDATE ON position_templates
WHEN NEW.rowid IS NOT OLD.rowid AND EXISTS(SELECT 1 FROM position_templates r JOIN bid_definition_versions v ON v.position_template_version=r.version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_rule_books_rowid_insert BEFORE INSERT ON rule_books
WHEN EXISTS(SELECT 1 FROM rule_books r JOIN bid_definition_versions v ON v.rule_book_version=r.version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_rule_books_rowid_update BEFORE UPDATE ON rule_books
WHEN NEW.rowid IS NOT OLD.rowid AND EXISTS(SELECT 1 FROM rule_books r JOIN bid_definition_versions v ON v.rule_book_version=r.version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_positions_rowid_insert BEFORE INSERT ON positions
WHEN EXISTS(SELECT 1 FROM positions r JOIN bid_definition_versions v ON v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_positions_rowid_update BEFORE UPDATE ON positions
WHEN NEW.rowid IS NOT OLD.rowid AND EXISTS(SELECT 1 FROM positions r JOIN bid_definition_versions v ON v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_position_rules_rowid_insert BEFORE INSERT ON position_rules
WHEN EXISTS(SELECT 1 FROM position_rules r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version OR v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_position_rules_rowid_update BEFORE UPDATE ON position_rules
WHEN NEW.rowid IS NOT OLD.rowid AND EXISTS(SELECT 1 FROM position_rules r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version OR v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_rule_book_position_participation_rowid_insert BEFORE INSERT ON rule_book_position_participation
WHEN EXISTS(SELECT 1 FROM rule_book_position_participation r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version OR v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_rule_book_position_participation_rowid_update BEFORE UPDATE ON rule_book_position_participation
WHEN NEW.rowid IS NOT OLD.rowid AND EXISTS(SELECT 1 FROM rule_book_position_participation r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version OR v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_position_staffing_bindings_rowid_insert BEFORE INSERT ON position_staffing_bindings
WHEN EXISTS(SELECT 1 FROM position_staffing_bindings r JOIN bid_definition_versions v ON v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_position_staffing_bindings_rowid_update BEFORE UPDATE ON position_staffing_bindings
WHEN NEW.rowid IS NOT OLD.rowid AND EXISTS(SELECT 1 FROM position_staffing_bindings r JOIN bid_definition_versions v ON v.position_template_version=r.template_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_annual_bid_policy_documents_rowid_insert BEFORE INSERT ON annual_bid_policy_documents
WHEN EXISTS(SELECT 1 FROM annual_bid_policy_documents r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
CREATE TRIGGER bid_version_annual_bid_policy_documents_rowid_update BEFORE UPDATE ON annual_bid_policy_documents
WHEN NEW.rowid IS NOT OLD.rowid AND EXISTS(SELECT 1 FROM annual_bid_policy_documents r JOIN bid_definition_versions v ON v.rule_book_version=r.rule_book_version WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid version row identity is immutable'); END;
