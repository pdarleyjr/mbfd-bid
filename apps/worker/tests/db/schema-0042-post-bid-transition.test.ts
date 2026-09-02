import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = resolve(__dirname, '../../migrations');

function apply(sqlite: Database.Database, through: string): void {
  for (const file of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
    if (file <= through) sqlite.exec(readFileSync(resolve(migrationsDir, file), 'utf8'));
  }
}

describe('migration 0042 post-Bid transition', () => {
  it('preserves Worker 2 migration reservation and adds immutable session-bound transition records', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    apply(sqlite, '0042_post_bid_transition.sql');
    const names = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
    expect(names).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'bid_post_bid_transitions' }),
      expect.objectContaining({ name: 'bid_post_bid_operation_receipts' }),
    ]));
    expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });

  it('applies cleanly as the explicit 0040-to-0042 upgrade path', () => {
    const sqlite = new Database(':memory:');
    apply(sqlite, '0040_annual_bid_operations.sql');
    expect(() => sqlite.exec(readFileSync(resolve(migrationsDir, '0042_post_bid_transition.sql'), 'utf8'))).not.toThrow();
    sqlite.close();
  });
});
