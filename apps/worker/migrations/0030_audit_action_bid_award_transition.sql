-- 0030_audit_action_bid_award_transition.sql
--
-- D1/SQLite stores audit_log.action as TEXT without a database CHECK enum.
-- This migration documents the application-level audit vocabulary addition
-- for a reviewed, effective-dated transition from completed real Bid awards
-- to future canonical staffing assignments.  No existing audit evidence or
-- production/staging data is rewritten.

SELECT 1 FROM audit_log LIMIT 1;
