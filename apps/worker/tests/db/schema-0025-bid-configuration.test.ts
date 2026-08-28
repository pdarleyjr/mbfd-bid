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
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function seedSnapshotReferences(sqlite: Database.Database): void {
  sqlite
    .prepare("INSERT INTO position_templates (version, effective_year) VALUES ('2035.1', 2035)")
    .run();
  sqlite
    .prepare(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2035.1', 2035, 'draft')",
    )
    .run();
  sqlite.prepare("INSERT INTO bid_years (year, status) VALUES (2035, 'configuring')").run();
  for (const id of [
    'legacy-snapshot',
    'v2-missing',
    'v2-mismatch',
    'v2-valid',
    'v3-missing',
    'v3-snapshot-revision-missing',
    'v3-mismatch',
    'v3-valid',
  ]) {
    sqlite
      .prepare(
        `INSERT INTO bid_sessions
           (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
         VALUES (?, 2035, 1, 'config', 180, 2, 0, 1)`,
      )
      .run(id);
  }
}

function snapshotJson(version: 1 | 2 | 3): string {
  const common = {
    ruleBookVersion: '2035.1',
    positionTemplateVersion: '2035.1',
    capturedAtMs: 1,
  };
  return JSON.stringify(
    version === 1
      ? { v: 1, ...common, members: [] }
      : version === 2
        ? {
            v: 2,
            ...common,
            members: [],
            ruleBookRevision: 0,
            configurationRevision: 1,
            settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
          }
        : {
            v: 3,
            ...common,
            ruleBookRevision: 0,
            configurationRevision: 1,
            settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
            members: [
              {
                memberId: 1,
                pool: 'FF',
                rscSeniority: 1,
                rankSeniority: 1,
                exclusionReason: null,
                authoritativeAssignmentId: null,
                rank: 'FF',
                isProbationary: false,
                credentialNames: ['EMT'],
              },
            ],
            ruleBookMaterial: {
              v: 1,
              rules: [
                {
                  ruleBookVersion: '2035.1',
                  positionId: 'position-001',
                  templateVersion: '2035.1',
                  requiredCriteriaJson: '[]',
                  pointsPreferenceJson: '[]',
                  tieBreakChainJson: '[]',
                },
              ],
              positions: [
                {
                  id: 'position-001',
                  templateVersion: '2035.1',
                  bidParticipation: 'BIDDABLE',
                  isExcludedFromCount: false,
                  shift: 'A',
                  station: '1',
                  unit: 'Engine 1',
                  rankRequired: 'FF',
                  positionName: 'Synthetic Firefighter',
                },
              ],
            },
          },
  );
}

describe('annual bid configuration and snapshot revision schema (migration 0025)', () => {
  it('exports the annual configuration and V2 policy revision columns', () => {
    expect(Object.hasOwn(schema.bidYears, 'configurationRevision')).toBe(true);
    expect(Object.hasOwn(schema.bidSessionPolicySnapshots, 'ruleBookRevision')).toBe(true);
  });

  it('preserves legacy V1 snapshots while requiring an exact revision for fresh V2 snapshots', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedSnapshotReferences(sqlite);

    sqlite
      .prepare(
        `INSERT INTO bid_session_policy_snapshots
           (bid_session_id, rule_book_version, position_template_version, snapshot_json, captured_at)
         VALUES (?, '2035.1', '2035.1', ?, 1)`,
      )
      .run('legacy-snapshot', snapshotJson(1));
    expect(
      sqlite
        .prepare(
          'SELECT rule_book_revision FROM bid_session_policy_snapshots WHERE bid_session_id = ?',
        )
        .get('legacy-snapshot'),
    ).toEqual({ rule_book_revision: null });
    expect(() =>
      sqlite
        .prepare(
          'UPDATE bid_session_policy_snapshots SET snapshot_json = snapshot_json WHERE bid_session_id = ?',
        )
        .run('legacy-snapshot'),
    ).toThrow(/immutable/i);

    const insertV2 = sqlite.prepare(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, '2035.1', '2035.1', ?, ?, 1)`,
    );
    expect(() => insertV2.run('v2-missing', null, snapshotJson(2))).toThrow(/revision/i);
    expect(() => insertV2.run('v2-mismatch', 1, snapshotJson(2))).toThrow(/revision/i);
    expect(() => insertV2.run('v2-valid', 0, snapshotJson(2))).not.toThrow();
    expect(
      sqlite.prepare('SELECT configuration_revision FROM bid_years WHERE year = 2035').get(),
    ).toEqual({ configuration_revision: 0 });
    sqlite.close();
  });

  it('requires exact database revision metadata for fresh V3 material snapshots', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedSnapshotReferences(sqlite);

    const insertV3 = sqlite.prepare(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, '2035.1', '2035.1', ?, ?, 1)`,
    );
    const { ruleBookRevision: _omittedRevision, ...v3WithoutSnapshotRevision } = JSON.parse(
      snapshotJson(3),
    ) as Record<string, unknown>;
    const v3WithMismatchedSnapshotRevision = JSON.parse(snapshotJson(3)) as {
      ruleBookRevision: number;
    };
    v3WithMismatchedSnapshotRevision.ruleBookRevision = 1;

    expect(() => insertV3.run('v3-missing', null, snapshotJson(3))).toThrow(/revision/i);
    expect(() =>
      insertV3.run('v3-snapshot-revision-missing', 0, JSON.stringify(v3WithoutSnapshotRevision)),
    ).toThrow(/revision/i);
    expect(() =>
      insertV3.run('v3-mismatch', 0, JSON.stringify(v3WithMismatchedSnapshotRevision)),
    ).toThrow(/revision/i);
    expect(() => insertV3.run('v3-valid', 0, snapshotJson(3))).not.toThrow();
    expect(
      sqlite
        .prepare(
          `SELECT
             rule_book_revision,
             json_extract(snapshot_json, '$.v') AS snapshot_version,
             json_extract(snapshot_json, '$.ruleBookRevision') AS snapshot_rule_book_revision
           FROM bid_session_policy_snapshots
           WHERE bid_session_id = ?`,
        )
        .get('v3-valid'),
    ).toEqual({
      rule_book_revision: 0,
      snapshot_version: 3,
      snapshot_rule_book_revision: 0,
    });
    sqlite.close();
  });
});
