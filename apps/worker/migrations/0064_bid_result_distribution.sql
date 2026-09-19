-- External publication evidence is separate from assignment transition and exports.
CREATE TABLE bid_result_distribution_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  completion_seq INTEGER NOT NULL CHECK(completion_seq >= 0),
  completion_command_id TEXT NOT NULL,
  package_sha256 TEXT NOT NULL CHECK(length(package_sha256) = 64),
  channel TEXT NOT NULL CHECK(channel IN ('EMAIL','TARGETSOLUTIONS')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN ('COMPLETED','REQUIRES_FOLLOW_UP')),
  published_on TEXT,
  evidence_ref TEXT NOT NULL CHECK(length(trim(evidence_ref)) >= 4),
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 4),
  actor_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK((status='COMPLETED' AND published_on IS NOT NULL) OR (status='REQUIRES_FOLLOW_UP' AND published_on IS NULL)),
  UNIQUE(bid_session_id,completion_seq,channel,revision)
);
CREATE TRIGGER bid_result_distribution_reviews_no_update BEFORE UPDATE ON bid_result_distribution_reviews
BEGIN SELECT RAISE(ABORT,'result distribution evidence is immutable'); END;
CREATE TRIGGER bid_result_distribution_reviews_no_delete BEFORE DELETE ON bid_result_distribution_reviews
BEGIN SELECT RAISE(ABORT,'result distribution evidence is immutable'); END;
