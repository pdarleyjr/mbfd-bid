CREATE TABLE post_award_obligation_reviews (
  id TEXT PRIMARY KEY,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  final_bid_id TEXT NOT NULL,
  obligation_id TEXT NOT NULL,
  completion_seq INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  effective_on TEXT NOT NULL CHECK(date(effective_on,'+0 days') IS effective_on),
  status TEXT NOT NULL CHECK(status IN ('COMPLETED','PENDING','UNKNOWN')),
  completed_on TEXT,
  source_ref TEXT NOT NULL CHECK(length(trim(source_ref))>=4),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(bid_session_id,final_bid_id,obligation_id,revision),
  CHECK((status='COMPLETED' AND completed_on IS NOT NULL AND date(completed_on,'+0 days') IS completed_on AND completed_on<=effective_on) OR (status IN ('PENDING','UNKNOWN') AND completed_on IS NULL))
);
CREATE TRIGGER obligation_review_revision_guard BEFORE INSERT ON post_award_obligation_reviews
WHEN NEW.revision IS NOT (SELECT COALESCE(MAX(revision),0)+1 FROM post_award_obligation_reviews WHERE bid_session_id=NEW.bid_session_id AND final_bid_id=NEW.final_bid_id AND obligation_id=NEW.obligation_id)
  OR NEW.effective_on < (SELECT MAX(effective_on) FROM post_award_obligation_reviews WHERE bid_session_id=NEW.bid_session_id AND final_bid_id=NEW.final_bid_id AND obligation_id=NEW.obligation_id)
  OR NOT EXISTS(SELECT 1 FROM canonical_bid_session_state s JOIN bid_sessions b ON b.id=s.bid_session_id JOIN bid_command_receipts r ON r.command_id=s.last_command_id AND r.bid_session_id=s.bid_session_id WHERE s.bid_session_id=NEW.bid_session_id AND s.current_seq=NEW.completion_seq AND r.result_seq=s.current_seq AND r.command_type='live.complete_session' AND r.outcome='accepted' AND b.is_mock=0)
BEGIN SELECT RAISE(ABORT,'obligation revision date or official completion changed'); END;
CREATE TRIGGER obligation_review_no_update BEFORE UPDATE ON post_award_obligation_reviews
BEGIN SELECT RAISE(ABORT,'obligation review is immutable'); END;
CREATE TRIGGER obligation_review_no_delete BEFORE DELETE ON post_award_obligation_reviews
BEGIN SELECT RAISE(ABORT,'obligation review is immutable'); END;
