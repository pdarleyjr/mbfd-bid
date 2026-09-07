-- The annual plan extends the existing bid year; it is not a competing cycle.
CREATE TABLE annual_plan_reviews (
  bid_year INTEGER PRIMARY KEY REFERENCES bid_years(year) ON DELETE RESTRICT,
  effective_on TEXT NOT NULL CHECK(date(effective_on, '+0 days') IS effective_on),
  source_session_id TEXT REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 0,
  reviewed_source_revision INTEGER,
  reviewed_rule_revision INTEGER,
  reviewed_configuration_revision INTEGER,
  source_policy_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE annual_plan_receipts (
  idempotency_key TEXT PRIMARY KEY,
  actor_subject TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER annual_plan_receipt_no_update BEFORE UPDATE ON annual_plan_receipts
BEGIN SELECT RAISE(ABORT, 'annual plan receipt is immutable'); END;
CREATE TRIGGER annual_plan_receipt_no_delete BEFORE DELETE ON annual_plan_receipts
BEGIN SELECT RAISE(ABORT, 'annual plan receipt is immutable'); END;

CREATE TABLE annual_source_revision (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
INSERT INTO annual_source_revision (id, revision) VALUES (1, 0);

-- Managed preparation cannot bypass its revision-bound review through the
-- existing advanced rule-book publication endpoint. Legacy years are untouched.
CREATE TRIGGER annual_plan_requires_current_review BEFORE UPDATE OF status ON rule_books
WHEN NEW.status = 'active' AND OLD.status <> 'active' AND EXISTS (
  SELECT 1 FROM annual_plan_reviews p JOIN bid_years y ON y.year = p.bid_year
  WHERE y.rule_book_version = NEW.version AND (
    p.reviewed_rule_revision IS NOT NEW.revision
    OR p.reviewed_configuration_revision IS NOT y.configuration_revision
    OR p.reviewed_source_revision IS NOT (SELECT revision FROM annual_source_revision WHERE id = 1)
  )
)
BEGIN SELECT RAISE(ABORT, 'annual preparation requires current revision review'); END;

CREATE TRIGGER annual_source_members_insert AFTER INSERT ON members
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_members_update AFTER UPDATE ON members
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_members_delete AFTER DELETE ON members
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_credentials_insert AFTER INSERT ON credentials
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_credentials_update AFTER UPDATE ON credentials
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_credentials_delete AFTER DELETE ON credentials
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_credential_catalog_metadata_insert AFTER INSERT ON credential_catalog_metadata
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_credential_catalog_metadata_update AFTER UPDATE ON credential_catalog_metadata
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_credential_catalog_metadata_delete AFTER DELETE ON credential_catalog_metadata
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_credentials_insert AFTER INSERT ON member_credentials
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_credentials_update AFTER UPDATE ON member_credentials
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_credentials_delete AFTER DELETE ON member_credentials
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_qualification_events_insert AFTER INSERT ON member_qualification_events
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_qualification_events_update AFTER UPDATE ON member_qualification_events
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_qualification_events_delete AFTER DELETE ON member_qualification_events
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_personnel_lifecycle_events_insert AFTER INSERT ON personnel_lifecycle_events
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_personnel_lifecycle_events_update AFTER UPDATE ON personnel_lifecycle_events
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_personnel_lifecycle_events_delete AFTER DELETE ON personnel_lifecycle_events
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_staffing_positions_insert AFTER INSERT ON staffing_positions
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_staffing_positions_update AFTER UPDATE ON staffing_positions
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_staffing_positions_delete AFTER DELETE ON staffing_positions
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_assignments_insert AFTER INSERT ON member_assignments
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_assignments_update AFTER UPDATE ON member_assignments
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_member_assignments_delete AFTER DELETE ON member_assignments
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_position_staffing_bindings_insert AFTER INSERT ON position_staffing_bindings
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_position_staffing_bindings_update AFTER UPDATE ON position_staffing_bindings
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_position_staffing_bindings_delete AFTER DELETE ON position_staffing_bindings
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_positions_insert AFTER INSERT ON positions
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_positions_update AFTER UPDATE ON positions
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_positions_delete AFTER DELETE ON positions
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_temporary_operational_overlays_insert AFTER INSERT ON temporary_operational_overlays
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_temporary_operational_overlays_update AFTER UPDATE ON temporary_operational_overlays
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER annual_source_temporary_operational_overlays_delete AFTER DELETE ON temporary_operational_overlays
BEGIN UPDATE annual_source_revision SET revision = revision + 1 WHERE id = 1; END;
