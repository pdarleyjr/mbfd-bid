-- 0017_seed_bid_years.sql
-- Bootstrap bid_years rows so /api/admin/bid-session can be created on a fresh
-- staging deploy without manually inserting a row first.
--
-- Idempotent: INSERT OR IGNORE leaves existing rows (and their statuses)
-- untouched. The seed script (apps/worker/seed/2026.ts) already inserts the
-- position_template / rule_book version '2026.1'; this migration intentionally
-- does NOT couple the bid_year row to those versions so it works even on the
-- very first deploy before seed has run.

INSERT OR IGNORE INTO bid_years (year, status, position_template_version, rule_book_version, config_json)
VALUES (2026, 'configuring', NULL, NULL, NULL);

INSERT OR IGNORE INTO bid_years (year, status, position_template_version, rule_book_version, config_json)
VALUES (2027, 'configuring', NULL, NULL, NULL);

INSERT OR IGNORE INTO bid_years (year, status, position_template_version, rule_book_version, config_json)
VALUES (2028, 'configuring', NULL, NULL, NULL);
