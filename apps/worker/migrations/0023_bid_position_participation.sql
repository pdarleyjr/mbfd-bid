-- Division Chief policy boundary: participation is versioned with a rule book
-- so an immutable active book can be cloned, corrected, fully validated, and
-- published without rewriting the active policy in place.

CREATE TABLE rule_book_position_participation (
  rule_book_version TEXT NOT NULL
    REFERENCES rule_books(version) ON DELETE RESTRICT,
  position_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  bid_participation TEXT NOT NULL
    CHECK (bid_participation IN ('BIDDABLE', 'ADMIN_ASSIGNED_NON_BIDDABLE')),
  authoritative_source_ref TEXT NOT NULL
    CHECK (
      length(trim(authoritative_source_ref)) > 0
      AND authoritative_source_ref = trim(authoritative_source_ref)
    ),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rule_book_version, position_id),
  FOREIGN KEY (position_id, template_version)
    REFERENCES positions(id, template_version) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX idx_rule_book_position_participation_template
  ON rule_book_position_participation (rule_book_version, template_version);
--> statement-breakpoint
CREATE TRIGGER rule_book_position_participation_draft_only_insert
BEFORE INSERT ON rule_book_position_participation
FOR EACH ROW
WHEN COALESCE((SELECT status FROM rule_books WHERE version = NEW.rule_book_version), '') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation is draft-only');
END;
--> statement-breakpoint
CREATE TRIGGER rule_book_position_participation_draft_only_update
BEFORE UPDATE ON rule_book_position_participation
FOR EACH ROW
WHEN COALESCE((SELECT status FROM rule_books WHERE version = OLD.rule_book_version), '') <> 'draft'
  OR COALESCE((SELECT status FROM rule_books WHERE version = NEW.rule_book_version), '') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation is draft-only');
END;
--> statement-breakpoint
CREATE TRIGGER rule_book_position_participation_rule_book_immutable
BEFORE UPDATE OF rule_book_version ON rule_book_position_participation
FOR EACH ROW
WHEN OLD.rule_book_version <> NEW.rule_book_version
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation rule book is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER rule_book_position_participation_draft_only_delete
BEFORE DELETE ON rule_book_position_participation
FOR EACH ROW
WHEN COALESCE((SELECT status FROM rule_books WHERE version = OLD.rule_book_version), '') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation is draft-only');
END;
--> statement-breakpoint

-- The annual Bid position identifier is not assumed to be the canonical
-- staffing identifier. A reviewed mapping is required before an authoritative
-- assignment can affect a Bid pool.
CREATE TABLE position_staffing_bindings (
  position_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  staffing_position_id TEXT NOT NULL
    REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  authoritative_source_ref TEXT NOT NULL
    CHECK (
      length(trim(authoritative_source_ref)) > 0
      AND authoritative_source_ref = trim(authoritative_source_ref)
    ),
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'approved', 'retired')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (position_id, template_version),
  FOREIGN KEY (position_id, template_version)
    REFERENCES positions(id, template_version) ON DELETE RESTRICT,
  UNIQUE (staffing_position_id, template_version)
);
--> statement-breakpoint
CREATE INDEX idx_position_staffing_bindings_staffing_position
  ON position_staffing_bindings (staffing_position_id);
--> statement-breakpoint
CREATE INDEX idx_position_staffing_bindings_review_status
  ON position_staffing_bindings (review_status);
--> statement-breakpoint

-- A session captures normalized pool input once. The JSON shape is validated
-- in application code on every read; an UPDATE trigger prevents accidental
-- changes to the frozen source of ordinary Bid membership.
CREATE TABLE bid_session_policy_snapshots (
  bid_session_id TEXT PRIMARY KEY NOT NULL
    REFERENCES bid_sessions(id) ON DELETE CASCADE,
  rule_book_version TEXT NOT NULL
    REFERENCES rule_books(version) ON DELETE RESTRICT,
  position_template_version TEXT NOT NULL
    REFERENCES position_templates(version) ON DELETE RESTRICT,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  captured_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_bid_session_policy_snapshots_rule_book
  ON bid_session_policy_snapshots (rule_book_version);
--> statement-breakpoint
CREATE TRIGGER bid_session_policy_snapshots_immutable
BEFORE UPDATE ON bid_session_policy_snapshots
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'bid session policy snapshot is immutable');
END;
