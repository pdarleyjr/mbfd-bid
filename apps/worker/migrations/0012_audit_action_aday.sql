-- 2026-05-19 — Plan 07 Task 9: documentation-only migration recording the
-- extension of audit_log.action with new A-Day enum values:
--   - 'a_day_pick'         — normal Phase 2 A-Day pick by the bidding member
--   - 'forced_a_day_pick'  — admin override of a Phase 2 A-Day pick
--
-- The `action` column is a plain TEXT field in SQLite (no CHECK constraint).
-- The enum is enforced in the application layer (Drizzle TS), so no DDL is
-- required here. This file exists to keep the migration journal continuous
-- alongside the TS-level change in apps/worker/src/db/schema.ts.

-- (intentionally no SQL statements)
SELECT 1;
