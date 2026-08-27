/**
 * Seed idempotency tests.
 *
 * Runs the SQL emitted by the 2026 seed logic against an in-memory SQLite
 * database (via the better-sqlite3 D1 adapter), then runs it again, and
 * asserts row counts did not double.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { buildSeedSqlFromFixtures } from '../seed/2026';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');
const FIXTURES_DIR = resolve(__dirname, '../seed/fixtures');

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

function applyMigrations(sqlite: Database.Database): void {
  const files = [
    '0001_init.sql',
    '0002_members_certs.sql',
    '0003_positions_rules.sql',
    '0004_bid_audit_ai.sql',
    '0005_audit_log_session_nullable.sql',
    '0013_audit_chain_bookkeeping.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .flatMap((chunk) => chunk.split(';'))
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      try {
        sqlite.exec(`${stmt};`);
      } catch {
        // ignore already-exists errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Inline seed logic (mirrors seed/2026.ts but targets an existing sqlite db)
// ---------------------------------------------------------------------------

interface PositionRecord {
  id: string;
  shift: string;
  station: string;
  division: string;
  unit: string;
  rankRequired: string;
  positionName: string;
  isFloating: boolean;
  isVacantByDesign: boolean;
  isExcludedFromCount: boolean;
}

interface CredentialRecord {
  name: string;
  fyPointsDefault: number;
}

interface RuleEntry {
  positionId: string;
  templateVersion: string;
  ruleBookVersion: string;
  requiredCriteria: { rank: string[]; credentials: string[]; custom: string[] };
  pointsPreference: { max: number; items: unknown[] };
  tieBreakChain: string[];
  notes?: string | null;
}

function makeDefaultRule(pos: PositionRecord): RuleEntry {
  const isRescue = pos.division === 'Rescue' || pos.unit.toLowerCase().includes('rescue');
  const credentials =
    isRescue && pos.rankRequired !== 'LT' && pos.rankRequired !== 'CPT' ? ['Paramedic'] : [];
  return {
    positionId: pos.id,
    templateVersion: '2026.1',
    ruleBookVersion: '2026.1',
    requiredCriteria: { rank: [pos.rankRequired], credentials, custom: [] },
    pointsPreference: { max: 0, items: [] },
    tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
    notes: 'Auto-generated placeholder',
  };
}

function buildAndExecuteSeed(sqlite: Database.Database, testAuditId: string): void {
  const positions: PositionRecord[] = JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, '2026_positions.json'), 'utf-8'),
  );
  const credentials: CredentialRecord[] = JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, 'reference_credentials.json'), 'utf-8'),
  );
  const explicitRules: RuleEntry[] = (
    JSON.parse(readFileSync(resolve(FIXTURES_DIR, '2026_rules.json'), 'utf-8')) as RuleEntry[]
  ).filter((r) => typeof r.positionId === 'string' && r.positionId.length > 0);

  const explicitByPositionId = new Map(explicitRules.map((r) => [r.positionId, r]));

  sqlite.exec(
    `INSERT OR IGNORE INTO position_templates (version, effective_year, notes) VALUES ('2026.1', 2026, NULL);`,
  );
  sqlite.exec(
    `INSERT OR IGNORE INTO rule_books (version, effective_year, notes) VALUES ('2026.1', 2026, NULL);`,
  );

  const upsertPos = sqlite.prepare(
    `INSERT OR REPLACE INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name,
        is_floating, is_vacant_by_design, is_excluded_from_count)
     VALUES (?, '2026.1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPosMany = sqlite.transaction((rows: PositionRecord[]) => {
    for (const p of rows) {
      upsertPos.run(
        p.id,
        p.shift,
        p.station,
        p.division,
        p.unit,
        p.rankRequired,
        p.positionName,
        p.isFloating ? 1 : 0,
        p.isVacantByDesign ? 1 : 0,
        p.isExcludedFromCount ? 1 : 0,
      );
    }
  });
  insertPosMany(positions);

  const insertCred = sqlite.prepare(
    'INSERT OR IGNORE INTO credentials (name, fy_points_default) VALUES (?, ?)',
  );
  const insertCredsMany = sqlite.transaction((rows: CredentialRecord[]) => {
    for (const c of rows) {
      insertCred.run(c.name, c.fyPointsDefault);
    }
  });
  insertCredsMany(credentials);

  sqlite.exec(
    `DELETE FROM position_rules WHERE template_version = '2026.1' AND rule_book_version = '2026.1';`,
  );

  const insertRule = sqlite.prepare(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain, notes)
     VALUES ('2026.1', ?, '2026.1', ?, ?, ?, ?)`,
  );
  const insertRulesMany = sqlite.transaction((rows: PositionRecord[]) => {
    for (const pos of rows) {
      if (pos.id === 'A701') continue;
      const rule = explicitByPositionId.get(pos.id) ?? makeDefaultRule(pos);
      insertRule.run(
        pos.id,
        JSON.stringify(rule.requiredCriteria),
        JSON.stringify(rule.pointsPreference),
        JSON.stringify(rule.tieBreakChain),
        rule.notes ?? null,
      );
    }
  });
  insertRulesMany(positions);

  const nowSec = Math.floor(Date.now() / 1000);
  sqlite.exec(
    `INSERT OR IGNORE INTO audit_log
       (id, bid_session_id, seq, actor_type, actor_id, action, target_kind, target_id,
        before_state, after_state, reason, ai_advisory_id, client_meta, created_at)
     VALUES ('${testAuditId}', NULL, 0, 'system', NULL, 'session_start', 'seed', '2026',
             NULL, NULL, 'Seed run 2026.ts', NULL, NULL, ${nowSec});`,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seed 2026 — idempotency', () => {
  it('first run inserts expected row counts', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);

    buildAndExecuteSeed(sqlite, 'test-audit-id-first');

    const ptCount = (
      sqlite.prepare('SELECT COUNT(*) as c FROM position_templates').get() as { c: number }
    ).c;
    const rbCount = (sqlite.prepare('SELECT COUNT(*) as c FROM rule_books').get() as { c: number })
      .c;
    const posCount = (
      sqlite
        .prepare("SELECT COUNT(*) as c FROM positions WHERE template_version = '2026.1'")
        .get() as {
        c: number;
      }
    ).c;
    const credCount = (
      sqlite.prepare('SELECT COUNT(*) as c FROM credentials').get() as { c: number }
    ).c;
    const ruleCount = (
      sqlite
        .prepare("SELECT COUNT(*) as c FROM position_rules WHERE template_version = '2026.1'")
        .get() as { c: number }
    ).c;

    expect(ptCount).toBe(1);
    expect(rbCount).toBe(1);
    expect(posCount).toBeGreaterThanOrEqual(230);
    expect(credCount).toBeGreaterThanOrEqual(30);
    // Rules = positions minus A701
    expect(ruleCount).toBe(posCount - 1);
  });

  it('second run does not double any rows (idempotency)', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);

    // First run
    buildAndExecuteSeed(sqlite, 'test-audit-id-run1');

    const countAfterFirst = {
      positions: (
        sqlite
          .prepare("SELECT COUNT(*) as c FROM positions WHERE template_version = '2026.1'")
          .get() as { c: number }
      ).c,
      credentials: (sqlite.prepare('SELECT COUNT(*) as c FROM credentials').get() as { c: number })
        .c,
      rules: (
        sqlite
          .prepare("SELECT COUNT(*) as c FROM position_rules WHERE template_version = '2026.1'")
          .get() as { c: number }
      ).c,
      templates: (
        sqlite.prepare('SELECT COUNT(*) as c FROM position_templates').get() as { c: number }
      ).c,
      ruleBooks: (sqlite.prepare('SELECT COUNT(*) as c FROM rule_books').get() as { c: number }).c,
    };

    // Second run
    buildAndExecuteSeed(sqlite, 'test-audit-id-run2');

    const countAfterSecond = {
      positions: (
        sqlite
          .prepare("SELECT COUNT(*) as c FROM positions WHERE template_version = '2026.1'")
          .get() as { c: number }
      ).c,
      credentials: (sqlite.prepare('SELECT COUNT(*) as c FROM credentials').get() as { c: number })
        .c,
      rules: (
        sqlite
          .prepare("SELECT COUNT(*) as c FROM position_rules WHERE template_version = '2026.1'")
          .get() as { c: number }
      ).c,
      templates: (
        sqlite.prepare('SELECT COUNT(*) as c FROM position_templates').get() as { c: number }
      ).c,
      ruleBooks: (sqlite.prepare('SELECT COUNT(*) as c FROM rule_books').get() as { c: number }).c,
    };

    expect(countAfterSecond.positions).toBe(countAfterFirst.positions);
    expect(countAfterSecond.credentials).toBe(countAfterFirst.credentials);
    expect(countAfterSecond.rules).toBe(countAfterFirst.rules);
    expect(countAfterSecond.templates).toBe(countAfterFirst.templates);
    expect(countAfterSecond.ruleBooks).toBe(countAfterFirst.ruleBooks);
  });

  it('uses the real seed SQL and creates only one deterministic audit marker on retry', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);

    sqlite.exec(buildSeedSqlFromFixtures());
    sqlite.exec(buildSeedSqlFromFixtures());

    const auditCount = (
      sqlite
        .prepare(
          "SELECT COUNT(*) as c FROM audit_log WHERE action = 'session_start' AND target_kind = 'seed' AND target_id = '2026'",
        )
        .get() as { c: number }
    ).c;

    expect(auditCount).toBe(1);
  });

  it('Station 6 positions exist with marine positionNames', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    buildAndExecuteSeed(sqlite, 'test-audit-id-st6');

    const st6 = sqlite
      .prepare(
        "SELECT id, position_name FROM positions WHERE template_version = '2026.1' AND station = 'Station #6' ORDER BY id",
      )
      .all() as { id: string; position_name: string }[];

    expect(st6.length).toBe(9);
    const ids = st6.map((r) => r.id);
    expect(ids).toContain('A611');
    expect(ids).toContain('B612');
    expect(ids).toContain('C613');

    const names = new Set(st6.map((r) => r.position_name));
    expect(names.has('Firefighter FBO')).toBe(true);
    expect(names.has('Marine Firefighter')).toBe(true);
    expect(names.has('Post St.6')).toBe(true);
  });

  it('No Station 5 positions exist', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    buildAndExecuteSeed(sqlite, 'test-audit-id-no-st5');

    const st5 = sqlite
      .prepare(
        "SELECT id FROM positions WHERE template_version = '2026.1' AND station = 'Station #5'",
      )
      .all() as { id: string }[];

    expect(st5.length).toBe(0);
  });

  it('XX403 is Firefighter #1 (general pop, not Marine Deckhand)', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    buildAndExecuteSeed(sqlite, 'test-audit-id-403');

    const rows = sqlite
      .prepare(
        "SELECT id, position_name FROM positions WHERE template_version = '2026.1' AND id LIKE '_403'",
      )
      .all() as { id: string; position_name: string }[];

    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.position_name).toBe('Firefighter #1');
    }
  });

  it('credentials table has at least 30 entries', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    buildAndExecuteSeed(sqlite, 'test-audit-id-creds');

    const count = (sqlite.prepare('SELECT COUNT(*) as c FROM credentials').get() as { c: number })
      .c;
    expect(count).toBeGreaterThanOrEqual(30);
  });
});
