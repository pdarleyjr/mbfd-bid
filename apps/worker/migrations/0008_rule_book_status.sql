-- 0008_rule_book_status.sql
-- Plan 05 Task 3 — adds publishing metadata to rule_books.
-- Numbered 0008 (not 0006 as the plan body says) because Plan 04 already used
-- 0006 for bid_session_freeze and 0007 for the R-Day -> A-Day rename.

ALTER TABLE rule_books ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'active', 'archived'));

ALTER TABLE rule_books ADD COLUMN published_at INTEGER;
ALTER TABLE rule_books ADD COLUMN published_by INTEGER REFERENCES members(id) ON DELETE SET NULL;

-- Backfill: any pre-existing rule book is treated as 'active' (the seed v2026.1).
UPDATE rule_books SET status = 'active', published_at = strftime('%s', 'now') * 1000
  WHERE status = 'draft';

-- At most one ACTIVE rule book per effective_year.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_books_active_per_year
  ON rule_books (effective_year) WHERE status = 'active';
