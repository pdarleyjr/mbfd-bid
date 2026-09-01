-- Live policy core: preserve the old participation rows while extending the
-- closed enum. RESERVED_NON_BIDDABLE is deliberately distinct from an
-- administrative assignment: a vacant reserved slot remains a vacancy and
-- cannot become a general Bid opportunity.
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE rule_book_position_participation_v2 (
  rule_book_version TEXT NOT NULL REFERENCES rule_books(version) ON DELETE RESTRICT,
  position_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  bid_participation TEXT NOT NULL CHECK (bid_participation IN ('BIDDABLE', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'RESERVED_NON_BIDDABLE')),
  authoritative_source_ref TEXT NOT NULL CHECK (length(trim(authoritative_source_ref)) > 0 AND authoritative_source_ref = trim(authoritative_source_ref)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rule_book_version, position_id),
  FOREIGN KEY (position_id, template_version) REFERENCES positions(id, template_version) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO rule_book_position_participation_v2
  (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
SELECT rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at
FROM rule_book_position_participation;
--> statement-breakpoint
DROP TABLE rule_book_position_participation;
--> statement-breakpoint
ALTER TABLE rule_book_position_participation_v2 RENAME TO rule_book_position_participation;
--> statement-breakpoint
CREATE INDEX idx_rule_book_position_participation_template
  ON rule_book_position_participation(rule_book_version, template_version);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE bid_award_amendments (
  id TEXT PRIMARY KEY,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  original_bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE RESTRICT,
  replacement_bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE RESTRICT,
  actor_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  expected_session_revision INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (original_bid_id),
  UNIQUE (replacement_bid_id)
);
--> statement-breakpoint
CREATE INDEX idx_bid_award_amendments_session_created
  ON bid_award_amendments(bid_session_id, created_at);
--> statement-breakpoint
ALTER TABLE bid_order ADD COLUMN stage_id TEXT;
--> statement-breakpoint
CREATE INDEX idx_bid_order_session_stage ON bid_order(bid_session_id, stage_id, ordinal);
