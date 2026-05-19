-- 0009_bid_session_config.sql
-- Plan 05 Task 11 — adds config_json blob to bid_sessions for pre-bid locks etc.
-- Numbered 0009 (not 0008 as the plan body says) because Plan 05 Task 3 already
-- claimed 0008 for the rule_books status column.
ALTER TABLE bid_sessions ADD COLUMN config_json TEXT;
