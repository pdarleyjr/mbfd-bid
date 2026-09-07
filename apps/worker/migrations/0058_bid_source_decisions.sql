CREATE TABLE bid_source_decisions (
 bid_year INTEGER NOT NULL, issue_id TEXT NOT NULL, revision INTEGER NOT NULL,
 title TEXT NOT NULL, question TEXT NOT NULL, area TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('OPEN','RESOLVED')),
 decision TEXT NOT NULL, source_ref TEXT NOT NULL, effective_on TEXT NOT NULL,
 actor_subject TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(bid_year,issue_id,revision)
);
CREATE TRIGGER bid_source_decisions_no_update BEFORE UPDATE ON bid_source_decisions
BEGIN SELECT RAISE(ABORT,'source decisions require a new revision'); END;
CREATE TRIGGER bid_source_decisions_no_delete BEFORE DELETE ON bid_source_decisions
BEGIN SELECT RAISE(ABORT,'source decision history is immutable'); END;
CREATE TRIGGER bid_source_decisions_invalidate AFTER INSERT ON bid_source_decisions
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
