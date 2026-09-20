-- A carry-forward starts with a legacy target source token, then creates its
-- first immutable definition. Preserve that exact initial expected token so a
-- lost response can replay the definition receipt without weakening the
-- optimistic-concurrency boundary or replacing an independently authored Bid.
CREATE TABLE annual_bid_structure_clone_state (
  idempotency_key TEXT PRIMARY KEY REFERENCES annual_plan_receipts(idempotency_key) ON DELETE RESTRICT,
  target_year INTEGER NOT NULL UNIQUE REFERENCES bid_years(year) ON DELETE RESTRICT,
  initial_expected_json TEXT NOT NULL CHECK(json_valid(initial_expected_json)),
  definition_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER annual_bid_structure_clone_state_no_update
BEFORE UPDATE ON annual_bid_structure_clone_state
BEGIN SELECT RAISE(ABORT, 'annual Bid carry-forward state is immutable'); END;

CREATE TRIGGER annual_bid_structure_clone_state_no_delete
BEFORE DELETE ON annual_bid_structure_clone_state
BEGIN SELECT RAISE(ABORT, 'annual Bid carry-forward state is immutable'); END;

CREATE TRIGGER annual_bid_structure_clone_state_no_replace
BEFORE INSERT ON annual_bid_structure_clone_state
WHEN EXISTS(SELECT 1 FROM annual_bid_structure_clone_state prior
  WHERE prior.idempotency_key=NEW.idempotency_key
    OR prior.target_year=NEW.target_year
    OR prior.definition_key=NEW.definition_key
    OR prior.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT, 'annual Bid carry-forward state identity is immutable'); END;
