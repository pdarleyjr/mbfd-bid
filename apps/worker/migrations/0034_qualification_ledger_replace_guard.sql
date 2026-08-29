-- SQLite's INSERT OR REPLACE conflict algorithm deletes the conflicting row
-- before inserting its replacement. With recursive_triggers disabled, that
-- implicit delete does not run the existing DELETE immutability trigger.
--
-- Guard duplicate primary-key and idempotency-key inserts before SQLite can
-- take the REPLACE path. This is additive and leaves every existing ledger
-- row, constraint, and append-only trigger intact.
CREATE TRIGGER member_qualification_events_are_immutable_replace
BEFORE INSERT ON member_qualification_events
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM member_qualification_events
  WHERE id = NEW.id
     OR idempotency_key = NEW.idempotency_key
)
BEGIN
  SELECT RAISE(ABORT, 'immutable qualification lifecycle events cannot be replaced');
END;
