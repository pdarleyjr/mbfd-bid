import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = resolve(__dirname, '../../migrations');

function applyMigrations(
  sqlite: Database.Database,
  from = '0001_init.sql',
  through = '9999_zzzz.sql',
): void {
  for (const file of readdirSync(migrationsDir)
    .filter((candidate) => candidate.endsWith('.sql') && candidate >= from && candidate <= through)
    .sort()) {
    sqlite.exec(readFileSync(resolve(migrationsDir, file), 'utf-8'));
  }
}

describe('migration 0040 annual bid operations', () => {
  it('adds preference, contact, and checkpoint persistence without rebuilding prior tables', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'bid_preference_sheets',
        'bid_contact_attempts',
        'bid_session_checkpoints',
      ]),
    );
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_bid_preference_sheets_session_status',
        'idx_bid_contact_attempts_session_member',
        'idx_bid_session_checkpoints_session_sequence',
      ]),
    );
    expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });

  it('applies cleanly as the explicit 0039-to-head upgrade path', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite, '0001_init.sql', '0039_restore_rule_book_participation_guards.sql');
    expect(() =>
      sqlite.exec(readFileSync(resolve(migrationsDir, '0040_annual_bid_operations.sql'), 'utf-8')),
    ).not.toThrow();
    sqlite.close();
  });
});
