import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

function applyMigrationsStrict(sqlite: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((candidate) => candidate.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function insertPosition(sqlite: Database.Database, id: string, slotKey: string): void {
  sqlite
    .prepare(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, review_status, created_at, updated_at)
       VALUES (?, ?, 'approved', ?, ?)`,
    )
    .run(id, slotKey, NOW, NOW);
}

function insertMapping(
  sqlite: Database.Database,
  id: string,
  slotId: string,
  sourceDiscriminator: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO staffing_position_source_mappings
         (id, staffing_position_id, source_system, source_locator, source_discriminator,
          source_signature, source_version, source_hash, effective_from, created_at)
       VALUES (?, ?, 'telestaff', 'A|Station 6|Fire Boat 6|Marine Float', ?, ?,
         'TELSTAFF_ASSIGNMENTS_HTML_V1', ?, '2026-01-01', ?)`,
    )
    .run(id, slotId, sourceDiscriminator, 'a'.repeat(64), 'b'.repeat(64), NOW);
}

describe('staffing source discriminator schema (migration 0028)', () => {
  it('exports a reviewer-controlled discriminator on the canonical source mapping', () => {
    expect(Object.hasOwn(schema.staffingPositionSourceMappings, 'sourceDiscriminator')).toBe(true);
  });

  it('permits explicitly distinct duplicate topology seats but never silently reuses a discriminator', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    insertPosition(sqlite, 'marine-float-1', 'SYNTHETIC/B/6/MARINE-FLOAT/1');
    insertPosition(sqlite, 'marine-float-2', 'SYNTHETIC/B/6/MARINE-FLOAT/2');

    insertMapping(sqlite, 'mapping-marine-float-1', 'marine-float-1', 'seat-1');
    insertMapping(sqlite, 'mapping-marine-float-2', 'marine-float-2', 'seat-2');

    expect(() =>
      insertMapping(sqlite, 'mapping-marine-float-duplicate', 'marine-float-2', 'seat-2'),
    ).toThrow();
    expect(() =>
      insertMapping(sqlite, 'mapping-marine-float-blank', 'marine-float-2', ''),
    ).toThrow();

    sqlite.close();
  });
});
