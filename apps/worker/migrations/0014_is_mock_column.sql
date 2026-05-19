-- Plan 09 / Rehearsal Tooling — Task R1.
--
-- Adds the `is_mock` flag to `bid_sessions`. Mock sessions are real bid
-- sessions used by admins for rehearsal/training. They behave identically
-- to live sessions for picks + audit, but:
--   - The portal write-back consumer skips them (so the live HR system
--     never sees a rehearsal pick).
--   - They are surfaced in the /admin/rehearsal dashboard with reset and
--     auto-bid affordances.
--   - The Plan 09 cutover safety check blocks promotion to production if
--     any mock sessions are incomplete.
--
-- Defaults to 0 so every existing session (and any session created without
-- explicit opt-in) remains a real, production-bound session.

ALTER TABLE `bid_sessions` ADD COLUMN `is_mock` integer NOT NULL DEFAULT 0;
