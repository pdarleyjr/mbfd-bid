-- 2026-05-19 — terminology change: department uses "A-Day" instead of "R-Day".
-- Renames bids.r_day column and updates any in-flight bid_sessions.current_phase
-- records that contain the old enum literal. The CHECK constraint on current_phase
-- is enforced in the application layer (Drizzle TS enum), not the DB, so no
-- constraint surgery is needed. The drizzle snapshot files under meta/ still
-- carry the old strings; they'll regenerate the next time db:generate is run
-- against a safe schema.

ALTER TABLE bids RENAME COLUMN r_day TO a_day;

UPDATE bid_sessions SET current_phase = 'a_day_bid' WHERE current_phase = 'r_day_bid';
