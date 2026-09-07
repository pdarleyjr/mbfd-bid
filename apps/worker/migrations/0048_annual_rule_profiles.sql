CREATE TABLE annual_rule_profile_revisions (
  bid_year INTEGER NOT NULL REFERENCES annual_plan_reviews(bid_year) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  rule_revision INTEGER NOT NULL,
  profiles_json TEXT NOT NULL CHECK(json_valid(profiles_json)),
  compiled_json TEXT NOT NULL CHECK(json_valid(compiled_json)),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bid_year, revision)
);
CREATE TRIGGER annual_rule_profile_no_update BEFORE UPDATE ON annual_rule_profile_revisions
BEGIN SELECT RAISE(ABORT, 'profile revision is immutable'); END;

CREATE TRIGGER annual_plan_preserve_personnel_date BEFORE UPDATE OF config_json ON bid_years
WHEN EXISTS (SELECT 1 FROM annual_plan_reviews p WHERE p.bid_year=NEW.year
  AND json_extract(NEW.config_json,'$.personnelEvaluationOn') IS NOT p.effective_on)
BEGIN SELECT RAISE(ABORT, 'managed annual personnel date must be preserved'); END;
CREATE TRIGGER annual_rule_profile_no_delete BEFORE DELETE ON annual_rule_profile_revisions
BEGIN SELECT RAISE(ABORT, 'profile revision is immutable'); END;
