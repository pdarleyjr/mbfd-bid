-- A completed full Days Bid tour is not inferred from current placement or service months.
CREATE TABLE member_bid_tour_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>0),
  effective_on TEXT NOT NULL CHECK(effective_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  completed_days_tour INTEGER CHECK(completed_days_tour IN (0,1)),
  source_ref TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(member_id,revision)
);
CREATE TRIGGER member_bid_tour_revision BEFORE INSERT ON member_bid_tour_evidence
WHEN NEW.revision != COALESCE((SELECT MAX(revision) FROM member_bid_tour_evidence WHERE member_id=NEW.member_id),0)+1
BEGIN SELECT RAISE(ABORT,'bid tour evidence revision conflict'); END;
CREATE TRIGGER member_bid_tour_no_update BEFORE UPDATE ON member_bid_tour_evidence
BEGIN SELECT RAISE(ABORT,'bid tour evidence is immutable'); END;
CREATE TRIGGER member_bid_tour_no_delete BEFORE DELETE ON member_bid_tour_evidence
BEGIN SELECT RAISE(ABORT,'bid tour evidence is immutable'); END;
CREATE TRIGGER member_bid_tour_source_revision AFTER INSERT ON member_bid_tour_evidence
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
