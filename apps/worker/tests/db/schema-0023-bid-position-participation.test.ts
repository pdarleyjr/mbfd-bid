import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function applyMigrationsStrict(sqlite: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    // Trigger bodies contain semicolons, so execute each complete migration.
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function seedAnnualPosition(sqlite: Database.Database): void {
  sqlite
    .prepare('INSERT INTO position_templates (version, effective_year) VALUES (?, ?)')
    .run('2030.1', 2030);
  sqlite
    .prepare(
      `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('A211', '2030.1', 'A', '2', 'Combat', '300', 'DC', 'Division Chief');
}

describe('rule-book participation and session-policy schema (migration 0023)', () => {
  it('exports the rule-book-scoped participation, reviewed binding, and frozen-session tables', () => {
    expect(schema.ruleBookPositionParticipation).toBeDefined();
    expect(schema.positionStaffingBindings).toBeDefined();
    expect(schema.bidSessionPolicySnapshots).toBeDefined();
  });

  it('allows a participation correction only while its rule book is a draft and preserves foreign keys', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedAnnualPosition(sqlite);
    sqlite
      .prepare('INSERT INTO rule_books (version, effective_year, status) VALUES (?, ?, ?)')
      .run('2030.2', 2030, 'draft');
    sqlite
      .prepare('INSERT INTO rule_books (version, effective_year, status) VALUES (?, ?, ?)')
      .run('2031.active', 2031, 'active');

    const insertParticipation = sqlite.prepare(
      `INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertParticipation.run(
      '2030.2',
      'A211',
      '2030.1',
      'ADMIN_ASSIGNED_NON_BIDDABLE',
      'POL-015-approved-direction',
      1,
    );

    expect(() =>
      insertParticipation.run(
        '2030.2',
        'missing-position',
        '2030.1',
        'ADMIN_ASSIGNED_NON_BIDDABLE',
        'POL-015-approved-direction',
        1,
      ),
    ).toThrow(/foreign key/i);
    expect(() =>
      insertParticipation.run('2030.2', 'A211', '2030.1', 'BIDDABLE', ' unreviewed source ', 1),
    ).toThrow(/authoritative_source_ref/i);
    expect(() =>
      sqlite
        .prepare(
          `UPDATE rule_book_position_participation
           SET rule_book_version = ?
           WHERE rule_book_version = ? AND position_id = ?`,
        )
        .run('2031.active', '2030.2', 'A211'),
    ).toThrow(/rule book is immutable/i);

    sqlite.prepare("UPDATE rule_books SET status = 'active' WHERE version = ?").run('2030.2');
    expect(() =>
      sqlite
        .prepare(
          "UPDATE rule_book_position_participation SET bid_participation = 'BIDDABLE' WHERE rule_book_version = ? AND position_id = ?",
        )
        .run('2030.2', 'A211'),
    ).toThrow(/draft-only/i);
    expect(() =>
      sqlite
        .prepare(
          'DELETE FROM rule_book_position_participation WHERE rule_book_version = ? AND position_id = ?',
        )
        .run('2030.2', 'A211'),
    ).toThrow(/draft-only/i);
    expect(() =>
      insertParticipation.run(
        '2030.2',
        'A211',
        '2030.1',
        'BIDDABLE',
        'POL-015-approved-direction',
        1,
      ),
    ).toThrow(/draft-only/i);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });

  it('records only reviewed staffing bridges and prevents mutation of a captured session policy', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedAnnualPosition(sqlite);
    sqlite
      .prepare('INSERT INTO rule_books (version, effective_year, status) VALUES (?, ?, ?)')
      .run('2030.2', 2030, 'active');
    sqlite
      .prepare(
        `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('staff-A211', 'A211_STAFFING_SLOT', '2030-01-01', 'approved', 1, 1);

    sqlite
      .prepare(
        `INSERT INTO position_staffing_bindings
         (position_id, template_version, staffing_position_id, authoritative_source_ref, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('A211', '2030.1', 'staff-A211', 'POL-015-approved-direction', 1);
    expect(
      sqlite
        .prepare(
          'SELECT review_status FROM position_staffing_bindings WHERE position_id = ? AND template_version = ?',
        )
        .get('A211', '2030.1'),
    ).toEqual({ review_status: 'draft' });
    sqlite
      .prepare(
        "UPDATE position_staffing_bindings SET review_status = 'approved' WHERE position_id = ? AND template_version = ?",
      )
      .run('A211', '2030.1');
    expect(() =>
      sqlite
        .prepare(
          "UPDATE position_staffing_bindings SET review_status = 'unreviewed' WHERE position_id = ? AND template_version = ?",
        )
        .run('A211', '2030.1'),
    ).toThrow(/check constraint/i);

    sqlite.prepare('INSERT INTO bid_years (year, status) VALUES (?, ?)').run(2030, 'configuring');
    sqlite
      .prepare(
        `INSERT INTO bid_sessions (
          id, bid_year, started_at, current_phase, turn_timer_seconds,
          expected_duration_days, day_count, is_mock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('mock-session-0023', 2030, 1, 'config', 180, 2, 0, 1);
    sqlite
      .prepare(
        `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, snapshot_json, captured_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'mock-session-0023',
        '2030.2',
        '2030.1',
        '{"v":1,"ruleBookVersion":"2030.2","positionTemplateVersion":"2030.1","capturedAtMs":1,"members":[]}',
        1,
      );
    expect(() =>
      sqlite
        .prepare('UPDATE bid_session_policy_snapshots SET captured_at = ? WHERE bid_session_id = ?')
        .run(2, 'mock-session-0023'),
    ).toThrow(/immutable/i);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });
});
