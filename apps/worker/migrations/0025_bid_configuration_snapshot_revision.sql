-- 0025_bid_configuration_snapshot_revision.sql
--
-- A year designates one configuration source for mock rehearsals and the
-- eventual live Bid. Fresh V3 session policy snapshots retain both the exact
-- rule-book revision they were created from and their immutable rule material;
-- existing 0023/V1/V2 snapshots remain untouched and readable as legacy
-- records.

ALTER TABLE bid_years
  ADD COLUMN configuration_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE bid_session_policy_snapshots
  ADD COLUMN rule_book_revision INTEGER;
--> statement-breakpoint

-- Fresh V2/V3 snapshots must name the exact current revision of their
-- referenced rule book and agree with the serialized provenance. The existing
-- immutable-update trigger from 0023 continues to prevent any later rewrite.
-- Version-1 records are deliberately allowed so pre-0025 recovery data can
-- still be read and classified safely in code.
CREATE TRIGGER bid_session_policy_snapshots_v2_v3_rule_book_revision_required
BEFORE INSERT ON bid_session_policy_snapshots
FOR EACH ROW
WHEN json_extract(NEW.snapshot_json, '$.v') IN (2, 3)
 AND (
    NEW.rule_book_revision IS NULL
    OR json_extract(NEW.snapshot_json, '$.ruleBookRevision') IS NOT NEW.rule_book_revision
    OR NOT EXISTS (
     SELECT 1
     FROM rule_books
     WHERE version = NEW.rule_book_version
       AND revision = NEW.rule_book_revision
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'session policy snapshot rule book revision is invalid');
END;
