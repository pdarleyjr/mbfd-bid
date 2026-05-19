import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

describe('Mock-draft schema (mig 0014)', () => {
  it('bid_sessions table has is_mock column in Drizzle schema', () => {
    expect(schema.bidSessions.isMock).toBeDefined();
  });

  it('bid_sessions.is_mock defaults to 0 (false) when row inserted without value', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    applyMigrations(sqlite);

    sqlite
      .prepare("INSERT INTO bid_years (year, status) VALUES (2027, 'configuring')")
      .run();
    sqlite
      .prepare(
        'INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2027, ?, ?, ?, ?, ?)',
      )
      .run('01HZZTESTSESSION00000000001', Date.now(), 'config', 180, 2, 0);

    const row = sqlite
      .prepare('SELECT is_mock FROM bid_sessions WHERE id = ?')
      .get('01HZZTESTSESSION00000000001') as { is_mock: number };
    expect(row.is_mock).toBe(0);
    sqlite.close();
  });
});
