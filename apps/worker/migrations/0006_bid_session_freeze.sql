-- Plan 04 Task 1 — one-way freeze flag distinct from pause.
-- Adds frozen_at + actor + reason to bid_sessions. Drizzle-kit's auto-generated
-- output rewrote the bids table by mistake; this migration is hand-authored to
-- include only the intended changes. The drizzle meta journal will be brought
-- back into sync at the end of Plan 04 once the schema is stable.
ALTER TABLE bid_sessions ADD COLUMN frozen_at INTEGER;
ALTER TABLE bid_sessions ADD COLUMN freeze_actor_id INTEGER REFERENCES members(id) ON DELETE RESTRICT;
ALTER TABLE bid_sessions ADD COLUMN freeze_reason TEXT;
