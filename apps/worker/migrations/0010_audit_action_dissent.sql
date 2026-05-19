-- 0010_audit_action_dissent.sql
-- Plan 06 Task 14 — adds 'dissent' to the audit_log.action enum.
-- D1 (SQLite) does not enforce text enums at the DB level — drizzle does the
-- enforcement in code, so this migration is a recordkeeping no-op DDL paired
-- with the AuditAction TS union widening in src/lib/audit.ts.
--
-- Numbered 0010 (not 0005 as the plan body says) because Plan 05 already
-- claimed 0005..0009. The next free number was 0010.
SELECT 1 FROM audit_log LIMIT 1;
