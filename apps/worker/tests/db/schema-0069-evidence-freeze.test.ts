import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const tables = [
  'members',
  'credentials',
  'credential_catalog_metadata',
  'member_credentials',
  'member_qualification_events',
  'personnel_lifecycle_events',
  'member_service_evidence',
  'staffing_positions',
  'member_assignments',
  'assignment_imports',
  'assignment_import_rows',
  'assignment_observations',
  'assignment_import_missing_observations',
  'bid_year_staffing_baselines',
  'staffing_tenure_evidence',
  'targetsolutions_imports',
  'targetsolutions_rows',
  'bid_ordinal_datasets',
  'member_bid_tour_evidence',
  'bid_definition_heads',
  'bid_definition_versions',
  'bid_years',
];

describe('2026 cutoff evidence storage migration', () => {
  it('records relevant post-cutoff mutations, stops logging after a sealed capture, and prevents replacement', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = ON');
      // One second after the former 24-hour logging limit: a delayed freeze
      // must still detect relevant writes.
      sqlite.function('unixepoch', { varargs: true }, () => 1790888401);
      for (const table of tables)
        sqlite.exec(
          table === 'bid_years'
            ? 'CREATE TABLE bid_years (year INTEGER PRIMARY KEY)'
            : `CREATE TABLE "${table}" (id TEXT PRIMARY KEY)`,
        );
      sqlite.prepare('INSERT INTO bid_years(year) VALUES (?)').run(2026);
      sqlite.prepare('INSERT INTO bid_definition_versions(id) VALUES (?)').run('version-9');
      const path = new URL('../../migrations/0069_bid_evidence_freeze.sql', import.meta.url);
      const migration = readFileSync(path, 'utf8');
      sqlite.exec(migration);
      sqlite.prepare('INSERT INTO members(id) VALUES (?)').run('one');
      expect(
        sqlite.prepare('SELECT table_name,operation FROM bid_cutoff_mutations').all(),
      ).toStrictEqual([{ table_name: 'members', operation: 'INSERT' }]);
      sqlite
        .prepare(`INSERT INTO bid_evidence_freezes
        (id,bid_year,cutoff_at,time_zone,captured_at,actor_subject,source_version_id,
         source_version_sha256,source_token,evaluation_json,personnel_source_json,
         credential_source_json,evaluation_sha256,
         personnel_sha256,credential_sha256,source_imports_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          'freeze-1',
          2026,
          '2026-09-30T17:00:00-04:00',
          'America/New_York',
          1790802000000,
          'test-actor',
          'version-9',
          ...Array(2).fill('a'.repeat(64)),
          '{}',
          '{}',
          '{}',
          ...Array(3).fill('a'.repeat(64)),
          '[]',
        );
      sqlite.prepare('INSERT INTO members(id) VALUES (?)').run('two');
      expect(
        sqlite.prepare('SELECT COUNT(*) AS count FROM bid_cutoff_mutations').get(),
      ).toStrictEqual({ count: 1 });
      expect(() =>
        sqlite.prepare('UPDATE bid_evidence_freezes SET actor_subject=?').run('other'),
      ).toThrow('immutable');
      expect(() => sqlite.prepare('DELETE FROM bid_evidence_freezes').run()).toThrow('immutable');
      expect(() =>
        sqlite
          .prepare(`INSERT OR REPLACE INTO bid_evidence_freezes
        SELECT * FROM bid_evidence_freezes WHERE id='freeze-1'`)
          .run(),
      ).toThrow('immutable');
    } finally {
      sqlite.close();
    }
  });
});
