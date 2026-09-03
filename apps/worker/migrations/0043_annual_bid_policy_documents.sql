-- Versioned human-readable annual policy. Published language is immutable;
-- amendments are represented by a new draft revision tied to the same rule book.
CREATE TABLE annual_bid_policy_documents (
  id TEXT PRIMARY KEY NOT NULL,
  rule_book_version TEXT NOT NULL REFERENCES rule_books(version) ON DELETE RESTRICT,
  effective_year INTEGER NOT NULL REFERENCES bid_years(year) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  policy_text TEXT NOT NULL CHECK (length(trim(policy_text)) > 0),
  execution_policy_json TEXT NOT NULL CHECK (length(trim(execution_policy_json)) > 0),
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  published_at INTEGER,
  supersedes_document_id TEXT REFERENCES annual_bid_policy_documents(id) ON DELETE RESTRICT,
  UNIQUE (rule_book_version, revision)
);

CREATE INDEX idx_annual_bid_policy_documents_year_status
  ON annual_bid_policy_documents (effective_year, status, revision DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_annual_bid_policy_documents_one_published
  ON annual_bid_policy_documents (rule_book_version)
  WHERE status = 'PUBLISHED';
