-- REPLACE can delete a conflicting row without firing DELETE triggers when
-- recursive_triggers is disabled. Reject all occupied identities before that
-- conflict handling, including explicit SQLite rowid aliases.
CREATE TRIGGER bid_ordinal_dataset_no_replace BEFORE INSERT ON bid_ordinal_datasets
WHEN EXISTS (
  SELECT 1 FROM bid_ordinal_datasets prior
  WHERE prior.id=NEW.id OR prior.idempotency_key=NEW.idempotency_key
    OR (prior.bid_year=NEW.bid_year AND prior.revision=NEW.revision)
    OR prior.rowid=NEW.rowid
)
BEGIN SELECT RAISE(ABORT,'bid ordinal dataset identity is sealed'); END;

CREATE TRIGGER member_bid_tour_no_replace BEFORE INSERT ON member_bid_tour_evidence
WHEN EXISTS (
  SELECT 1 FROM member_bid_tour_evidence prior
  WHERE prior.id=NEW.id OR prior.idempotency_key=NEW.idempotency_key
    OR (prior.member_id=NEW.member_id AND prior.revision=NEW.revision)
    OR prior.rowid=NEW.rowid
)
BEGIN SELECT RAISE(ABORT,'bid tour evidence identity is sealed'); END;

CREATE TRIGGER bid_result_distribution_reviews_no_replace BEFORE INSERT ON bid_result_distribution_reviews
WHEN EXISTS (
  SELECT 1 FROM bid_result_distribution_reviews prior
  WHERE prior.id=NEW.id
    OR (prior.bid_session_id=NEW.bid_session_id AND prior.completion_seq=NEW.completion_seq
      AND prior.channel=NEW.channel AND prior.revision=NEW.revision)
    OR prior.rowid=NEW.rowid
)
BEGIN SELECT RAISE(ABORT,'result distribution evidence identity is sealed'); END;

-- JSON integer syntax alone does not guarantee JavaScript-exact integers.
-- Keep direct inserts within the same safe numeric domain as the API.
CREATE TRIGGER bid_ordinal_dataset_safe_integers BEFORE INSERT ON bid_ordinal_datasets
WHEN typeof(NEW.bid_year)!='integer' OR typeof(NEW.revision)!='integer'
  OR NEW.revision>9007199254740991 OR EXISTS (
    SELECT 1 FROM json_each(NEW.entries_json) entry
    WHERE json_extract(entry.value,'$.memberId')>9007199254740991
      OR json_extract(entry.value,'$.timeInGrade')>9007199254740991
      OR json_extract(entry.value,'$.departmentService')>9007199254740991
  )
BEGIN SELECT RAISE(ABORT,'bid ordinal evidence requires safe integers'); END;
