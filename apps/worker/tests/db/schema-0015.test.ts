import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
}

function applyMigrations(sqlite: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
    const statements = sql
      .split('--> statement-breakpoint')
      .flatMap((chunk) => chunk.split(';'))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        sqlite.exec(`${stmt};`);
      } catch {
        // ignore already-exists / column-exists noise across migration replays
      }
    }
  }
}

describe('Rehearsal findings schema (mig 0015)', () => {
  it('exports rehearsalFindings table with all columns in Drizzle schema', () => {
    expect(schema.rehearsalFindings).toBeDefined();
    expect(schema.rehearsalFindings.id).toBeDefined();
    expect(schema.rehearsalFindings.bidSessionId).toBeDefined();
    expect(schema.rehearsalFindings.createdAt).toBeDefined();
    expect(schema.rehearsalFindings.authorId).toBeDefined();
    expect(schema.rehearsalFindings.note).toBeDefined();
    expect(schema.rehearsalFindings.screenshotR2Key).toBeDefined();
  });

  it('rehearsal_findings physical table exists with the correct columns', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    applyMigrations(sqlite);

    const cols = sqlite.prepare("PRAGMA table_info('rehearsal_findings')").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ['author_id', 'bid_session_id', 'created_at', 'id', 'note', 'screenshot_r2_key'].sort(),
    );

    // Migration 0017 pre-seeds 2026/2027/2028; pick a year outside that range.
    sqlite.prepare("INSERT INTO bid_years (year, status) VALUES (2099, 'configuring')").run();
    sqlite
      .prepare(
        'INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2099, ?, ?, ?, ?, ?)',
      )
      .run('01HZZTESTSESSION00000000002', Date.now(), 'config', 180, 2, 0);
    sqlite
      .prepare(
        'INSERT INTO rehearsal_findings (id, bid_session_id, created_at, note) VALUES (?, ?, ?, ?)',
      )
      .run('01HZZFINDING000000000000001', '01HZZTESTSESSION00000000002', Date.now(), 'boom');
    const row = sqlite
      .prepare('SELECT note FROM rehearsal_findings WHERE id = ?')
      .get('01HZZFINDING000000000000001') as { note: string };
    expect(row.note).toBe('boom');
    sqlite.close();
  });
});
