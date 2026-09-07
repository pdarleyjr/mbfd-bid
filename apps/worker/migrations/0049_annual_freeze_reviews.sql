-- Every mutable input used by preparation invalidates a reviewed source revision.
CREATE TRIGGER annual_source_position_rules_insert AFTER INSERT ON position_rules
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_position_rules_update AFTER UPDATE ON position_rules
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_position_rules_delete AFTER DELETE ON position_rules
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_rule_book_position_participation_insert AFTER INSERT ON rule_book_position_participation
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_rule_book_position_participation_update AFTER UPDATE ON rule_book_position_participation
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_rule_book_position_participation_delete AFTER DELETE ON rule_book_position_participation
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_bid_year_staffing_baselines_insert AFTER INSERT ON bid_year_staffing_baselines
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_bid_year_staffing_baselines_update AFTER UPDATE ON bid_year_staffing_baselines
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_bid_year_staffing_baselines_delete AFTER DELETE ON bid_year_staffing_baselines
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_imports_insert AFTER INSERT ON assignment_imports
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_imports_update AFTER UPDATE ON assignment_imports
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_imports_delete AFTER DELETE ON assignment_imports
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_import_rows_insert AFTER INSERT ON assignment_import_rows
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_import_rows_update AFTER UPDATE ON assignment_import_rows
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_import_rows_delete AFTER DELETE ON assignment_import_rows
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_observations_insert AFTER INSERT ON assignment_observations
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_observations_update AFTER UPDATE ON assignment_observations
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER annual_source_assignment_observations_delete AFTER DELETE ON assignment_observations
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TABLE annual_freeze_reviews (
  id TEXT PRIMARY KEY,
  bid_year INTEGER NOT NULL REFERENCES annual_plan_reviews(bid_year) ON DELETE RESTRICT,
  mock_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  mock_completion_seq INTEGER NOT NULL,
  rule_revision INTEGER NOT NULL,
  configuration_revision INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  actor_subject TEXT NOT NULL,
  review_reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER annual_freeze_review_no_update BEFORE UPDATE ON annual_freeze_reviews
BEGIN SELECT RAISE(ABORT,'freeze review is immutable'); END;
CREATE TRIGGER annual_freeze_review_no_delete BEFORE DELETE ON annual_freeze_reviews
BEGIN SELECT RAISE(ABORT,'freeze review is immutable'); END;
