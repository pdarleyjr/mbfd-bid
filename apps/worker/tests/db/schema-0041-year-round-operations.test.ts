import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('.', import.meta.url));
const migrationsDirectory = resolve(directory, '../../migrations');

function applyLocallyPresentMigrations(sqlite: Database.Database): void {
  for (const file of readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
  }
}

describe('migration 0041 year-round operations', () => {
  it('creates the review and overlay tables/indexes on a fresh locally present migration chain', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyLocallyPresentMigrations(sqlite);

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'qualification_review_batches',
        'qualification_review_rows',
        'temporary_operational_overlays',
      ]),
    );
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_qualification_review_rows_batch',
        'idx_temporary_operational_overlays_member_active',
      ]),
    );
    expect(sqlite.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });
});
