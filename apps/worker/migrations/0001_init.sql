-- Initial migration. Real schema arrives in Plan 02.
-- For now, a minimal table so the D1 binding is exercised.

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('plan', '01');
INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '0001');
