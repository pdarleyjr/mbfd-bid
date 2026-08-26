-- Prevent a draft rule edit from racing a previously validated publication.
-- Existing books begin at revision 0; each guarded draft mutation increments
-- the revision and publication requires the revision it validated.
ALTER TABLE rule_books ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
