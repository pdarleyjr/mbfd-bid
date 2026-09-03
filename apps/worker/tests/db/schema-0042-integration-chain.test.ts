import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('.', import.meta.url));
const migrationsDirectory = resolve(directory, '../../migrations');

function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
}

function applyThrough(sqlite: Database.Database, through: string): string[] {
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    if (file > through) break;
    sqlite.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
    applied.push(file);
  }
  return applied;
}

function applyOne(sqlite: Database.Database, file: string): void {
  sqlite.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
}

function expectFinalIntegrity(sqlite: Database.Database): void {
  expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);

  const triggers = sqlite
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  expect(triggers).toEqual(
    expect.arrayContaining([
      'rule_book_position_participation_draft_only_insert',
      'rule_book_position_participation_draft_only_update',
      'rule_book_position_participation_draft_only_delete',
      'rule_book_position_participation_rule_book_immutable',
    ]),
  );

  const indexes = sqlite
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  expect(indexes).toEqual(
    expect.arrayContaining([
      'idx_rule_book_position_participation_template',
      'idx_bid_preference_sheets_session_status',
      'idx_qualification_review_rows_batch',
      'idx_bid_post_bid_transitions_year_status',
    ]),
  );

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  expect(tables).toEqual(
    expect.arrayContaining([
      'bid_preference_sheets',
      'bid_contact_attempts',
      'bid_session_checkpoints',
      'qualification_review_batches',
      'qualification_review_rows',
      'temporary_operational_overlays',
      'bid_post_bid_transitions',
      'bid_post_bid_operation_receipts',
      'annual_bid_policy_documents',
    ]),
  );
}

describe('integration migration chain 0038 through 0043', () => {
  it('is gap-free and applies from a fresh database through the final candidate', () => {
    expect(migrationFiles().slice(-6)).toEqual([
      '0038_live_policy_participation_and_amendments.sql',
      '0039_restore_rule_book_participation_guards.sql',
      '0040_annual_bid_operations.sql',
      '0041_year_round_operations.sql',
      '0042_post_bid_transition.sql',
      '0043_annual_bid_policy_documents.sql',
    ]);

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const applied = applyThrough(sqlite, '0043_annual_bid_policy_documents.sql');
    expect(applied.at(-1)).toBe('0043_annual_bid_policy_documents.sql');
    expectFinalIntegrity(sqlite);

    // A D1 migration ledger would record every applied filename; a second
    // discovery sees no pending migration rather than replaying SQL files.
    const migrationLedger = new Set(applied);
    expect(migrationFiles().filter((file) => !migrationLedger.has(file))).toEqual([]);
    sqlite.close();
  });

  it('applies each required upgrade boundary in the intended order', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyThrough(sqlite, '0037_staffing_baseline_trigger_decomposition.sql');

    applyOne(sqlite, '0038_live_policy_participation_and_amendments.sql');
    applyOne(sqlite, '0039_restore_rule_book_participation_guards.sql');
    applyOne(sqlite, '0040_annual_bid_operations.sql');
    applyOne(sqlite, '0041_year_round_operations.sql');
    applyOne(sqlite, '0042_post_bid_transition.sql');
    applyOne(sqlite, '0043_annual_bid_policy_documents.sql');

    expectFinalIntegrity(sqlite);
    sqlite.close();
  });
});
