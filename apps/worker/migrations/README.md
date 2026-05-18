# Migrations

## Migration file overview

| File | Origin | Notes |
|------|--------|-------|
| `0001_init.sql` | Hand-written (Plan 01) | Minimal placeholder. Creates a `schema_meta` table and inserts two seed rows so the D1 binding is exercised. Contains no application schema DDL. |
| `0002_members_certs.sql` | drizzle-kit generated (Plan 02) | Creates `members`, `credentials`, and `member_credentials` tables. |

## Why `_journal.json` starts at `0002`

`_journal.json` is drizzle-kit's internal state file — it tracks only migrations that drizzle-kit itself generated. Because `0001_init.sql` was hand-written (not produced by `drizzle-kit generate`), drizzle-kit has no record of it. The first entry drizzle-kit knows about is `0002_members_certs`.

This is intentional. D1 applies migrations in **filename order** (`0001_*` before `0002_*`), not by reading the drizzle journal. The two states are independent:

- D1 uses filenames to determine apply order.
- drizzle-kit uses `_journal.json` to determine what to generate next.

Do **not** add a synthetic `0001` entry to `_journal.json`; doing so would misrepresent what drizzle-kit produced and could confuse future `drizzle-kit generate` runs.
