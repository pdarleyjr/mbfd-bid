-- Review evidence only. The existing bid-year designation and publication
-- guards remain the configuration authority; these rows cannot freeze a plan.
CREATE TABLE annual_source_review_checkpoints (
  id TEXT PRIMARY KEY,
  bid_year INTEGER NOT NULL REFERENCES annual_plan_reviews(bid_year) ON DELETE RESTRICT,
  rule_revision INTEGER NOT NULL,
  configuration_revision INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX annual_source_review_by_year ON annual_source_review_checkpoints(bid_year,created_at,id);
CREATE TRIGGER annual_source_review_no_update BEFORE UPDATE ON annual_source_review_checkpoints
BEGIN SELECT RAISE(ABORT,'source review checkpoint is immutable'); END;
CREATE TRIGGER annual_source_review_no_delete BEFORE DELETE ON annual_source_review_checkpoints
BEGIN SELECT RAISE(ABORT,'source review checkpoint is immutable'); END;
