import { Buffer } from 'node:buffer';
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
    // Execute each migration as SQLite would, rather than splitting SQL on
    // semicolons. The corrected schema uses triggers to enforce immutable
    // source observations, whose bodies contain statement terminators.
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function advanceImportToApproved(
  sqlite: Database.Database,
  importId: string,
  approvedByMemberId = 1,
): void {
  sqlite.prepare('UPDATE assignment_imports SET status = ? WHERE id = ?').run('reviewed', importId);
  sqlite
    .prepare(
      'UPDATE assignment_imports SET status = ?, approved_at = ?, approved_by_member_id = ? WHERE id = ?',
    )
    .run('approved', 2, approvedByMemberId, importId);
}

function commitApprovedImport(sqlite: Database.Database, importId: string): void {
  sqlite
    .prepare('UPDATE assignment_imports SET status = ?, committed_at = ? WHERE id = ?')
    .run('committed', 3, importId);
}

describe('V2 canonical staffing schema (migration 0021)', () => {
  it('exports separate canonical-slot, source-mapping, observation, import, and authoritative-assignment tables', () => {
    expect(schema.staffingPositions).toBeDefined();
    expect(schema.staffingPositionSourceMappings).toBeDefined();
    expect(schema.memberAssignments).toBeDefined();
    expect(schema.assignmentImports).toBeDefined();
    expect(schema.assignmentImportRows).toBeDefined();
    expect(schema.assignmentObservations).toBeDefined();
    expect(Object.hasOwn(schema, 'assignmentAliases')).toBe(false);
    expect(Object.hasOwn(schema, 'assignmentServiceHistory')).toBe(false);
  });

  it('keeps canonical slot identity independent from source versions and source A/R Day', () => {
    expect(Object.hasOwn(schema.staffingPositions, 'stableSlotKey')).toBe(true);
    expect(Object.hasOwn(schema.staffingPositions, 'sourceSystem')).toBe(false);
    expect(Object.hasOwn(schema.staffingPositions, 'sourceRecordKey')).toBe(false);
    expect(Object.hasOwn(schema.staffingPositions, 'sourceVersion')).toBe(false);
    expect(Object.hasOwn(schema.staffingPositions, 'sourceHash')).toBe(false);
    expect(Object.hasOwn(schema.staffingPositions, 'aRDay')).toBe(false);
    expect(Object.hasOwn(schema.staffingPositions, 'aDay')).toBe(false);
    expect(Object.hasOwn(schema.assignmentImportRows, 'sourceARDay')).toBe(true);
    expect(Object.hasOwn(schema.assignmentObservations, 'sourceARDay')).toBe(true);
  });

  it('uses a complete source locator/signature mapping instead of a global source alias', () => {
    expect(Object.hasOwn(schema.staffingPositionSourceMappings, 'sourceLocator')).toBe(true);
    expect(Object.hasOwn(schema.staffingPositionSourceMappings, 'sourceSignature')).toBe(true);
    expect(Object.hasOwn(schema.staffingPositionSourceMappings, 'staffingPositionId')).toBe(true);
    expect(Object.hasOwn(schema.memberAssignments, 'originType')).toBe(true);
    expect(Object.hasOwn(schema.memberAssignments, 'originRef')).toBe(true);
    expect(Object.hasOwn(schema.memberAssignments, 'sourceObservationId')).toBe(true);
    expect(Object.hasOwn(schema.memberAssignments, 'sourceImportId')).toBe(false);
  });

  it('reserves a keyed opaque member reference instead of a lookup-prone identity hash', () => {
    expect(Object.hasOwn(schema.assignmentImportRows, 'memberReferenceHmac')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImportRows, 'memberReferenceHash')).toBe(false);
  });

  it('applies on a pristine database and keeps source evidence separate from authoritative assignments', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);

    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'staffing_positions',
        'staffing_position_source_mappings',
        'member_assignments',
        'assignment_imports',
        'assignment_import_rows',
        'assignment_observations',
      ]),
    );
    expect(tables.map((table) => table.name)).not.toContain('assignment_aliases');
    expect(tables.map((table) => table.name)).not.toContain('assignment_service_history');

    const staffingPositionColumns = sqlite
      .prepare("SELECT name FROM pragma_table_info('staffing_positions') ORDER BY cid")
      .all() as Array<{ name: string }>;
    expect(staffingPositionColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['stable_slot_key', 'active_from', 'active_to', 'applicable_rank']),
    );
    expect(staffingPositionColumns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining([
        'source_system',
        'source_record_key',
        'source_version',
        'source_hash',
        'a_r_day',
      ]),
    );

    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, division, station, unit, position_name, shift, applicable_rank, active_from, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'slot-1',
        'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER',
        'Operations',
        'Station 6',
        'Fire Boat 6',
        'Marine Engineer',
        'A',
        'Firefighter',
        '2026-01-01',
        'approved',
        1,
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mapping-1',
        'slot-1',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'c'.repeat(64),
        'sanitized-baseline',
        'd'.repeat(64),
        '2026-01-01',
        1,
      );

    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-1', 'telestaff', 'sanitized-baseline', 'a'.repeat(64), 1, 'staged', 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, member_reference_hmac, resolved_member_id, staffing_position_source_mapping_id, source_a_r_day, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'row-1',
        'import-1',
        1,
        'b'.repeat(64),
        'e'.repeat(64),
        1,
        'mapping-1',
        'G2',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'unchanged',
        'not_required',
        1,
      );
    const insertObservation = sqlite.prepare(
      'INSERT INTO assignment_observations (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id, staffing_position_source_mapping_id, source_a_r_day, normalized_source_topology, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const observationValues = [
      'observation-1',
      'import-1',
      'row-1',
      1,
      'slot-1',
      'mapping-1',
      'G2',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      2,
      2,
    ] as const;
    expect(() => insertObservation.run(...observationValues)).toThrow();

    advanceImportToApproved(sqlite, 'import-1');
    commitApprovedImport(sqlite, 'import-1');
    expect(() => insertObservation.run(...observationValues)).not.toThrow();

    const stagedRows = sqlite
      .prepare('SELECT COUNT(*) AS count FROM assignment_import_rows')
      .get() as { count: number };
    const assignments = sqlite
      .prepare('SELECT COUNT(*) AS count FROM member_assignments')
      .get() as { count: number };
    expect(stagedRows.count).toBe(1);
    expect(assignments.count).toBe(0);
    sqlite.close();
  });

  it('rejects noncanonical source digests, identifiers, and effective dates', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO staffing_positions (id, stable_slot_key, active_from, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('slot-invalid-date', 'INVALID_DATE_SLOT', '2026-02-30', 'approved', 1, 1),
    ).toThrow();
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-valid', 'VALID_SLOT', 'approved', 1, 1);

    const insertMapping = sqlite.prepare(
      'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() =>
      insertMapping.run(
        'mapping-invalid-signature',
        'slot-valid',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'z'.repeat(64),
        'sanitized-baseline',
        'a'.repeat(64),
        '2026-01-01',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertMapping.run(
        'mapping-binary-signature',
        'slot-valid',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        Buffer.alloc(64),
        'sanitized-baseline',
        'a'.repeat(64),
        '2026-01-01',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertMapping.run(
        'mapping-invalid-version',
        'slot-valid',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        '\tv1',
        'b'.repeat(64),
        '2026-01-01',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertMapping.run(
        'mapping-binary-hash',
        'slot-valid',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        'sanitized-baseline',
        Buffer.alloc(64),
        '2026-01-01',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertMapping.run(
        'mapping-invalid-hash-and-date',
        'slot-valid',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        'sanitized-baseline',
        'z'.repeat(64),
        'zz',
        1,
      ),
    ).toThrow();
    insertMapping.run(
      'mapping-valid',
      'slot-valid',
      'telestaff',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'a'.repeat(64),
      'sanitized-baseline',
      'b'.repeat(64),
      '2026-01-01',
      1,
    );

    const insertImport = sqlite.prepare(
      'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() =>
      insertImport.run(
        'import-invalid-version',
        'telestaff',
        '\tv1',
        'c'.repeat(64),
        0,
        'staged',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertImport.run(
        'import-invalid-hash',
        'telestaff',
        'sanitized-baseline',
        'z'.repeat(64),
        0,
        'staged',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertImport.run(
        'import-binary-hash',
        'telestaff',
        'sanitized-baseline',
        Buffer.alloc(64),
        0,
        'staged',
        1,
      ),
    ).toThrow();
    insertImport.run(
      'import-valid',
      'telestaff',
      'sanitized-baseline',
      'c'.repeat(64),
      2,
      'staged',
      1,
    );

    const insertRow = sqlite.prepare(
      'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, member_reference_hmac, normalized_source_topology, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() =>
      insertRow.run(
        'row-invalid-fingerprint',
        'import-valid',
        1,
        'z'.repeat(64),
        null,
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertRow.run(
        'row-binary-fingerprint',
        'import-valid',
        2,
        Buffer.alloc(64),
        null,
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertRow.run(
        'row-invalid-hmac',
        'import-valid',
        3,
        'd'.repeat(64),
        'z'.repeat(64),
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertRow.run(
        'row-binary-hmac',
        'import-valid',
        4,
        'd'.repeat(64),
        Buffer.alloc(64),
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        1,
      ),
    ).toThrow();

    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-member', 'Synthetic', 'Member', 'Firefighter', 'Firefighter', 1, 1, 1);
    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'assignment-invalid-date',
          1,
          'slot-valid',
          'BID_AWARD',
          'bid-award:invalid-date',
          'planned',
          'zz',
          1,
          1,
        ),
    ).toThrow();
    sqlite.close();
  });

  it('maps repeated source role labels only through their complete scoped locators', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-a', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-b', 'B_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);

    const insertMapping = sqlite.prepare(
      'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() =>
      insertMapping.run(
        'mapping-a',
        'slot-a',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        'sanitized-baseline',
        'b'.repeat(64),
        '2026-01-01',
        1,
      ),
    ).not.toThrow();
    expect(() =>
      insertMapping.run(
        'mapping-b',
        'slot-b',
        'telestaff',
        'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
        'c'.repeat(64),
        'sanitized-baseline',
        'd'.repeat(64),
        '2026-01-01',
        1,
      ),
    ).not.toThrow();
    expect(() =>
      insertMapping.run(
        'mapping-duplicate',
        'slot-b',
        'telestaff',
        'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
        'c'.repeat(64),
        'sanitized-baseline',
        'd'.repeat(64),
        '2026-01-01',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertMapping.run(
        'mapping-overlap',
        'slot-b',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'f'.repeat(64),
        'sanitized-baseline-revision-2',
        'e'.repeat(64),
        '2026-06-01',
        1,
      ),
    ).toThrow();
    sqlite.close();
  });

  it('fails closed when an import contains blocking or unresolved review-required rows', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-review', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mapping-review',
        'slot-review',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        'sanitized-baseline',
        'b'.repeat(64),
        '2026-01-01',
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-review', 'telestaff', 'sanitized-baseline', 'a'.repeat(64), 1, 'staged', 1);

    const insertRow = sqlite.prepare(
      'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology, disposition, review_status, reviewed_at, reviewed_by_member_id, resolution_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() =>
      insertRow.run(
        'row-invalid-review',
        'import-review',
        1,
        'b'.repeat(64),
        null,
        null,
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'moved',
        'not_required',
        null,
        null,
        null,
        1,
      ),
    ).toThrow();
    insertRow.run(
      'row-pending-review',
      'import-review',
      2,
      'c'.repeat(64),
      1,
      'mapping-review',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'moved',
      'pending',
      null,
      null,
      null,
      1,
    );

    expect(() => advanceImportToApproved(sqlite, 'import-review')).toThrow();

    sqlite
      .prepare(
        'UPDATE assignment_import_rows SET review_status = ?, reviewed_at = ?, reviewed_by_member_id = ?, resolution_reason = ? WHERE id = ?',
      )
      .run('approved', 2, 1, 'Synthetic move reviewed', 'row-pending-review');
    advanceImportToApproved(sqlite, 'import-review');
    expect(() => commitApprovedImport(sqlite, 'import-review')).not.toThrow();
    sqlite.close();
  });

  it('requires the declared source row count to match reconciled rows before commit', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-count', 'telestaff', 'sanitized-baseline', 'a'.repeat(64), 2, 'staged', 1);
    const insertRow = sqlite.prepare(
      'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, normalized_source_topology, disposition, review_status, reviewed_at, reviewed_by_member_id, resolution_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertRow.run(
      'row-count-1',
      'import-count',
      1,
      'b'.repeat(64),
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'missing_vanished',
      'approved',
      2,
      1,
      'Synthetic vanished assignment reviewed',
      1,
    );
    expect(() => advanceImportToApproved(sqlite, 'import-count')).toThrow();

    insertRow.run(
      'row-count-2',
      'import-count',
      2,
      'c'.repeat(64),
      'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
      'missing_vanished',
      'approved',
      2,
      1,
      'Synthetic vanished assignment reviewed',
      1,
    );
    advanceImportToApproved(sqlite, 'import-count');
    expect(() => commitApprovedImport(sqlite, 'import-count')).not.toThrow();
    sqlite.close();
  });

  it('freezes a human-reviewed row and its mapping before the import header commits', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    const insertSlot = sqlite.prepare(
      'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertSlot.run(
      'slot-reviewed-a',
      'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER',
      'approved',
      1,
      1,
    );
    insertSlot.run(
      'slot-reviewed-b',
      'B_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER',
      'approved',
      1,
      1,
    );
    sqlite
      .prepare(
        'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mapping-reviewed',
        'slot-reviewed-a',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        'sanitized-baseline',
        'b'.repeat(64),
        '2026-01-01',
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'import-reviewed-row',
        'telestaff',
        'sanitized-baseline',
        'c'.repeat(64),
        1,
        'staged',
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'row-reviewed',
        'import-reviewed-row',
        1,
        'd'.repeat(64),
        1,
        'mapping-reviewed',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'moved',
        'pending',
        1,
      );
    sqlite
      .prepare(
        'UPDATE assignment_import_rows SET review_status = ?, reviewed_at = ?, reviewed_by_member_id = ?, resolution_reason = ? WHERE id = ?',
      )
      .run('approved', 2, 1, 'Synthetic move reviewed', 'row-reviewed');

    expect(() =>
      sqlite
        .prepare("UPDATE assignment_import_rows SET source_a_r_day = 'G3' WHERE id = ?")
        .run('row-reviewed'),
    ).toThrow();
    expect(() =>
      sqlite.prepare('DELETE FROM assignment_import_rows WHERE id = ?').run('row-reviewed'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'UPDATE staffing_position_source_mappings SET staffing_position_id = ? WHERE id = ?',
        )
        .run('slot-reviewed-b', 'mapping-reviewed'),
    ).toThrow();
    advanceImportToApproved(sqlite, 'import-reviewed-row');
    expect(() =>
      sqlite.prepare('DELETE FROM assignment_imports WHERE id = ?').run('import-reviewed-row'),
    ).toThrow();
    const reviewedRowCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM assignment_import_rows WHERE import_id = ?')
      .get('import-reviewed-row') as { count: number };
    expect(reviewedRowCount.count).toBe(1);
    sqlite.close();
  });

  it('blocks conflict-replacement of a human-reviewed row by a staged row', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'import-row-conflict',
        'telestaff',
        'sanitized-baseline',
        'a'.repeat(64),
        2,
        'staged',
        1,
      );
    const insertRow = sqlite.prepare(
      'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, normalized_source_topology, disposition, review_status, reviewed_at, reviewed_by_member_id, resolution_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertRow.run(
      'row-final',
      'import-row-conflict',
      1,
      'b'.repeat(64),
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'missing_vanished',
      'approved',
      2,
      1,
      'Synthetic missing assignment reviewed',
      1,
    );
    insertRow.run(
      'row-staged',
      'import-row-conflict',
      2,
      'c'.repeat(64),
      'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
      'ambiguous_mapping',
      'pending',
      null,
      null,
      null,
      1,
    );

    expect(() =>
      sqlite
        .prepare('UPDATE OR REPLACE assignment_import_rows SET source_row_number = ? WHERE id = ?')
        .run(1, 'row-staged'),
    ).toThrow();
    const finalRow = sqlite
      .prepare('SELECT review_status FROM assignment_import_rows WHERE id = ?')
      .get('row-final') as { review_status: string } | undefined;
    expect(finalRow?.review_status).toBe('approved');
    sqlite.close();
  });

  it('refuses a final unchanged row that lacks its resolved source references', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'import-unresolved-unchanged',
        'telestaff',
        'sanitized-baseline',
        'a'.repeat(64),
        1,
        'staged',
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'row-unresolved-unchanged',
        'import-unresolved-unchanged',
        1,
        'b'.repeat(64),
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'unchanged',
        'not_required',
        1,
      );

    expect(() => advanceImportToApproved(sqlite, 'import-unresolved-unchanged')).toThrow();
    sqlite.close();
  });

  it('requires a staged mapping to match its import source and normalized locator', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-context', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    const insertMapping = sqlite.prepare(
      'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertMapping.run(
      'mapping-other-system',
      'slot-context',
      'other-system',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'a'.repeat(64),
      'sanitized-baseline',
      'b'.repeat(64),
      '2026-01-01',
      1,
    );
    insertMapping.run(
      'mapping-other-locator',
      'slot-context',
      'telestaff',
      'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
      'c'.repeat(64),
      'sanitized-baseline',
      'd'.repeat(64),
      '2026-01-01',
      1,
    );
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-context', 'telestaff', 'sanitized-baseline', 'e'.repeat(64), 2, 'staged', 1);
    const insertRow = sqlite.prepare(
      'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, staffing_position_source_mapping_id, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );

    expect(() =>
      insertRow.run(
        'row-other-system',
        'import-context',
        1,
        'f'.repeat(64),
        'mapping-other-system',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'ambiguous_mapping',
        'pending',
        1,
      ),
    ).toThrow();
    expect(() =>
      insertRow.run(
        'row-other-locator',
        'import-context',
        2,
        '0'.repeat(64),
        'mapping-other-locator',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'ambiguous_mapping',
        'pending',
        1,
      ),
    ).toThrow();
    sqlite.close();
  });

  it('freezes the ingest manifest at import creation', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-manifest', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mapping-manifest',
        'slot-manifest',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        'sanitized-baseline',
        'b'.repeat(64),
        '2026-01-01',
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-manifest', 'telestaff', 'sanitized-baseline', 'c'.repeat(64), 2, 'staged', 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'row-manifest',
        'import-manifest',
        1,
        'd'.repeat(64),
        1,
        'mapping-manifest',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'unchanged',
        'not_required',
        1,
      );

    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET input_row_count = ?, source_hash = ? WHERE id = ?')
        .run(1, 'e'.repeat(64), 'import-manifest'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'INSERT OR REPLACE INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('import-manifest', 'telestaff', 'rewritten', 'f'.repeat(64), 1, 'staged', 2),
    ).toThrow();
    sqlite.close();
  });

  it('freezes committed import evidence and its referenced source mapping', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    const insertSlot = sqlite.prepare(
      'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertSlot.run(
      'slot-frozen-a',
      'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER',
      'approved',
      1,
      1,
    );
    insertSlot.run(
      'slot-frozen-b',
      'B_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER',
      'approved',
      1,
      1,
    );
    sqlite
      .prepare(
        'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mapping-frozen',
        'slot-frozen-a',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'a'.repeat(64),
        'sanitized-baseline',
        'b'.repeat(64),
        '2026-01-01',
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-frozen', 'telestaff', 'sanitized-baseline', 'c'.repeat(64), 1, 'staged', 1);
    const insertRow = sqlite.prepare(
      'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertRow.run(
      'row-frozen',
      'import-frozen',
      1,
      'd'.repeat(64),
      1,
      'mapping-frozen',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'unchanged',
      'not_required',
      1,
    );
    advanceImportToApproved(sqlite, 'import-frozen');
    commitApprovedImport(sqlite, 'import-frozen');

    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET source_hash = ? WHERE id = ?')
        .run('e'.repeat(64), 'import-frozen'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET input_row_count = ? WHERE id = ?')
        .run(99, 'import-frozen'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'UPDATE staffing_position_source_mappings SET staffing_position_id = ? WHERE id = ?',
        )
        .run('slot-frozen-b', 'mapping-frozen'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'INSERT OR REPLACE INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('import-frozen', 'telestaff', 'rewritten', 'e'.repeat(64), 0, 'staged', 99),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'INSERT OR REPLACE INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'mapping-frozen',
          'slot-frozen-b',
          'telestaff',
          'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
          'e'.repeat(64),
          'rewritten',
          'f'.repeat(64),
          '2026-01-01',
          99,
        ),
    ).toThrow();

    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-staged', 'telestaff', 'sanitized-baseline', 'f'.repeat(64), 1, 'staged', 1);
    expect(() =>
      insertRow.run(
        'row-frozen',
        'import-staged',
        2,
        '0'.repeat(64),
        1,
        'mapping-frozen',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'unchanged',
        'not_required',
        1,
      ),
    ).toThrow();
    insertRow.run(
      'row-staged',
      'import-staged',
      2,
      '0'.repeat(64),
      1,
      'mapping-frozen',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'unchanged',
      'not_required',
      1,
    );
    expect(() =>
      sqlite
        .prepare('UPDATE assignment_import_rows SET import_id = ? WHERE id = ?')
        .run('import-frozen', 'row-staged'),
    ).toThrow();
    expect(() =>
      sqlite.prepare('DELETE FROM assignment_imports WHERE id = ?').run('import-frozen'),
    ).toThrow();
    const frozenRowCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM assignment_import_rows WHERE import_id = ?')
      .get('import-frozen') as { count: number };
    expect(frozenRowCount.count).toBe(1);
    sqlite
      .prepare(
        'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mapping-staged',
        'slot-frozen-b',
        'telestaff',
        'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
        '0'.repeat(64),
        'staged',
        '1'.repeat(64),
        '2026-01-01',
        4,
      );
    expect(() =>
      sqlite
        .prepare(
          'UPDATE OR REPLACE staffing_position_source_mappings SET id = ?, staffing_position_id = ?, source_locator = ?, source_signature = ?, source_version = ?, source_hash = ? WHERE id = ?',
        )
        .run(
          'mapping-frozen',
          'slot-frozen-b',
          'shift=C|station=6|unit=fire_boat_6|role=marine_engineer',
          '2'.repeat(64),
          'rewritten',
          '3'.repeat(64),
          'mapping-staged',
        ),
    ).toThrow();
    sqlite.close();
  });

  it('requires an observation to match its committed source row, mapping, canonical slot, and member', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-member-1', 'Synthetic', 'Member One', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(2, 'synthetic-member-2', 'Synthetic', 'Member Two', 'Chief', 'Admin', 2, 1, 1);
    const insertSlot = sqlite.prepare(
      'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertSlot.run('slot-1', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    insertSlot.run('slot-2', 'B_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    const insertMapping = sqlite.prepare(
      'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertMapping.run(
      'mapping-1',
      'slot-1',
      'telestaff',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'a'.repeat(64),
      'sanitized-baseline',
      'b'.repeat(64),
      '2026-01-01',
      1,
    );
    insertMapping.run(
      'mapping-2',
      'slot-2',
      'telestaff',
      'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
      'c'.repeat(64),
      'sanitized-baseline',
      'd'.repeat(64),
      '2026-01-01',
      1,
    );
    const insertImport = sqlite.prepare(
      'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insertImport.run('import-1', 'telestaff', 'sanitized-baseline', 'e'.repeat(64), 1, 'staged', 1);
    insertImport.run('import-2', 'telestaff', 'sanitized-baseline', 'f'.repeat(64), 1, 'staged', 1);
    const insertRow = sqlite.prepare(
      'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertRow.run(
      'row-1',
      'import-1',
      1,
      '1'.repeat(64),
      1,
      'mapping-1',
      'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
      'unchanged',
      'not_required',
      1,
    );
    insertRow.run(
      'row-2',
      'import-2',
      1,
      '2'.repeat(64),
      2,
      'mapping-2',
      'shift=B|station=6|unit=fire_boat_6|role=marine_engineer',
      'unchanged',
      'not_required',
      1,
    );
    advanceImportToApproved(sqlite, 'import-1');
    advanceImportToApproved(sqlite, 'import-2');
    commitApprovedImport(sqlite, 'import-1');
    commitApprovedImport(sqlite, 'import-2');

    const insertObservation = sqlite.prepare(
      'INSERT INTO assignment_observations (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id, staffing_position_source_mapping_id, normalized_source_topology, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const topology = 'shift=A|station=6|unit=fire_boat_6|role=marine_engineer';
    expect(() =>
      insertObservation.run(
        'cross-import',
        'import-1',
        'row-2',
        1,
        'slot-1',
        'mapping-1',
        topology,
        4,
        4,
      ),
    ).toThrow();
    expect(() =>
      insertObservation.run(
        'cross-mapping',
        'import-1',
        'row-1',
        1,
        'slot-2',
        'mapping-2',
        topology,
        4,
        4,
      ),
    ).toThrow();
    expect(() =>
      insertObservation.run(
        'cross-member',
        'import-1',
        'row-1',
        2,
        'slot-1',
        'mapping-1',
        topology,
        4,
        4,
      ),
    ).toThrow();
    expect(() =>
      insertObservation.run(
        'observation-valid',
        'import-1',
        'row-1',
        1,
        'slot-1',
        'mapping-1',
        topology,
        4,
        4,
      ),
    ).not.toThrow();
    sqlite.close();
  });

  it('prevents changes to source-backed immutable observations', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-immutable', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_position_source_mappings (id, staffing_position_id, source_system, source_locator, source_signature, source_version, source_hash, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mapping-immutable',
        'slot-immutable',
        'telestaff',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        '1'.repeat(64),
        'sanitized-baseline',
        '2'.repeat(64),
        '2026-01-01',
        1,
      );
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('import-immutable', 'telestaff', 'sanitized-baseline', '3'.repeat(64), 1, 'staged', 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology, disposition, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'row-immutable',
        'import-immutable',
        1,
        '4'.repeat(64),
        1,
        'mapping-immutable',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        'unchanged',
        'not_required',
        1,
      );
    advanceImportToApproved(sqlite, 'import-immutable');
    commitApprovedImport(sqlite, 'import-immutable');
    sqlite
      .prepare(
        'INSERT INTO assignment_observations (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id, staffing_position_source_mapping_id, normalized_source_topology, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'observation-immutable',
        'import-immutable',
        'row-immutable',
        1,
        'slot-immutable',
        'mapping-immutable',
        'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
        2,
        2,
      );

    const insertAssignment = sqlite.prepare(
      'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id, status, effective_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() =>
      insertAssignment.run(
        'assignment-observation-valid',
        1,
        'slot-immutable',
        'TELESTAFF_IMPORT',
        'synthetic-import-reconciliation',
        'observation-immutable',
        'active',
        '2026-01-01',
        2,
        2,
      ),
    ).not.toThrow();
    expect(() =>
      insertAssignment.run(
        'assignment-observation-missing',
        1,
        'slot-immutable',
        'TELESTAFF_IMPORT',
        'synthetic-import-reconciliation-missing',
        null,
        'cancelled',
        '2026-01-01',
        2,
        2,
      ),
    ).toThrow();
    expect(() =>
      insertAssignment.run(
        'assignment-observation-wrong-origin',
        1,
        'slot-immutable',
        'BID_AWARD',
        'synthetic-bid-award',
        'observation-immutable',
        'cancelled',
        '2026-01-01',
        2,
        2,
      ),
    ).toThrow();
    insertAssignment.run(
      'assignment-replacement-candidate',
      1,
      'slot-immutable',
      'BID_AWARD',
      'synthetic-bid-award-replacement-candidate',
      null,
      'cancelled',
      '2026-01-01',
      2,
      2,
    );

    expect(() =>
      sqlite
        .prepare(
          'UPDATE member_assignments SET origin_type = ?, origin_ref = ?, source_observation_id = ? WHERE id = ?',
        )
        .run('BID_AWARD', 'synthetic-bid-award-retyped', null, 'assignment-observation-valid'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('DELETE FROM member_assignments WHERE id = ?')
        .run('assignment-observation-valid'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'INSERT OR REPLACE INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id, status, effective_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'assignment-replacement-by-observation',
          1,
          'slot-immutable',
          'TELESTAFF_IMPORT',
          'synthetic-import-replacement',
          'observation-immutable',
          'cancelled',
          '2026-01-01',
          3,
          3,
        ),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'UPDATE OR REPLACE member_assignments SET origin_type = ?, origin_ref = ?, source_observation_id = ? WHERE id = ?',
        )
        .run(
          'TELESTAFF_IMPORT',
          'synthetic-import-replacement',
          'observation-immutable',
          'assignment-replacement-candidate',
        ),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE OR REPLACE member_assignments SET id = ? WHERE id = ?')
        .run('assignment-observation-valid', 'assignment-replacement-candidate'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'UPDATE member_assignments SET status = ?, effective_to = ?, updated_at = ? WHERE id = ?',
        )
        .run('ended', '2026-12-31', 3, 'assignment-observation-valid'),
    ).not.toThrow();

    expect(() =>
      sqlite
        .prepare("UPDATE assignment_observations SET source_a_r_day = 'G3' WHERE id = ?")
        .run('observation-immutable'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'INSERT OR REPLACE INTO assignment_observations (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id, staffing_position_source_mapping_id, normalized_source_topology, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'observation-immutable',
          'import-immutable',
          'row-immutable',
          1,
          'slot-immutable',
          'mapping-immutable',
          'shift=A|station=6|unit=fire_boat_6|role=marine_engineer',
          999,
          999,
        ),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('DELETE FROM assignment_observations WHERE id = ?')
        .run('observation-immutable'),
    ).toThrow();
    sqlite.close();
  });

  it('allows a future bid award assignment before a TeleStaff import exists', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-member', 'Synthetic', 'Member', 'Firefighter', 'Firefighter', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-award', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'award-1',
          1,
          'slot-award',
          'BID_AWARD',
          'bid-award:synthetic-1',
          'planned',
          '2027-01-01',
          1,
          1,
        ),
    ).not.toThrow();

    const assignmentColumns = sqlite
      .prepare("SELECT name FROM pragma_table_info('member_assignments') ORDER BY cid")
      .all() as Array<{ name: string }>;
    expect(assignmentColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'origin_type',
        'origin_ref',
        'status',
        'effective_from',
        'effective_to',
      ]),
    );
    expect(assignmentColumns.map((column) => column.name)).not.toContain('source_import_id');
    expect(() =>
      sqlite
        .prepare('UPDATE staffing_positions SET review_status = ? WHERE id = ?')
        .run('draft', 'slot-award'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE staffing_positions SET active_to = ? WHERE id = ?')
        .run('2026-12-31', 'slot-award'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE staffing_positions SET stable_slot_key = ? WHERE id = ?')
        .run('RENAMED_SLOT', 'slot-award'),
    ).toThrow();
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('slot-draft', 'DRAFT_SLOT', 'draft', 1, 1);
    sqlite
      .prepare(
        'INSERT INTO staffing_positions (id, stable_slot_key, active_from, active_to, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('slot-retired', 'RETIRED_SLOT', '2026-01-01', '2026-12-31', 'retired', 1, 1);
    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('slot-retired-unbounded', 'RETIRED_UNBOUNDED_SLOT', 'retired', 1, 1),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'draft-assignment',
          1,
          'slot-draft',
          'BID_AWARD',
          'bid-award:draft',
          'planned',
          '2027-01-01',
          1,
          1,
        ),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'retired-out-of-range-assignment',
          1,
          'slot-retired',
          'BID_AWARD',
          'bid-award:retired',
          'planned',
          '2027-01-01',
          '2027-12-31',
          1,
          1,
        ),
    ).toThrow();
    sqlite.close();
  });

  it('does not reactivate a terminal assignment after its slot is no longer authorized', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-member', 'Synthetic', 'Member', 'Firefighter', 'Firefighter', 1, 1, 1);
    const insertSlot = sqlite.prepare(
      'INSERT INTO staffing_positions (id, stable_slot_key, active_from, active_to, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const insertTerminalAssignment = sqlite.prepare(
      'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );

    insertSlot.run(
      'slot-demoted',
      'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER',
      '2030-01-01',
      '2030-12-31',
      'approved',
      1,
      1,
    );
    insertTerminalAssignment.run(
      'assignment-demoted',
      1,
      'slot-demoted',
      'BID_AWARD',
      'bid-award:demoted',
      'cancelled',
      '2030-01-01',
      '2030-12-31',
      1,
      1,
    );
    expect(() =>
      sqlite
        .prepare('UPDATE staffing_positions SET review_status = ? WHERE id = ?')
        .run('draft', 'slot-demoted'),
    ).not.toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE member_assignments SET status = ? WHERE id = ?')
        .run('planned', 'assignment-demoted'),
    ).toThrow();

    insertSlot.run(
      'slot-shortened',
      'B_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER',
      '2030-01-01',
      '2030-12-31',
      'approved',
      1,
      1,
    );
    insertTerminalAssignment.run(
      'assignment-shortened',
      1,
      'slot-shortened',
      'BID_AWARD',
      'bid-award:shortened',
      'cancelled',
      '2030-01-01',
      '2030-12-31',
      1,
      1,
    );
    expect(() =>
      sqlite
        .prepare('UPDATE staffing_positions SET active_to = ? WHERE id = ?')
        .run('2030-06-30', 'slot-shortened'),
    ).not.toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE member_assignments SET status = ? WHERE id = ?')
        .run('active', 'assignment-shortened'),
    ).toThrow();
    sqlite.close();
  });

  it('rejects overlapping authoritative assignments to the same singular canonical slot or member', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    const insertMember = sqlite.prepare(
      'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertMember.run(
      1,
      'synthetic-member-1',
      'Synthetic',
      'Member One',
      'Firefighter',
      'FF',
      1,
      1,
      1,
    );
    insertMember.run(
      2,
      'synthetic-member-2',
      'Synthetic',
      'Member Two',
      'Firefighter',
      'FF',
      2,
      1,
      1,
    );
    const insertSlot = sqlite.prepare(
      'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertSlot.run('slot-1', 'A_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    insertSlot.run('slot-2', 'B_SHIFT/STATION_6/FIRE_BOAT_6/MARINE_ENGINEER', 'approved', 1, 1);
    const insertAssignment = sqlite.prepare(
      'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertAssignment.run(
      'assignment-1',
      1,
      'slot-1',
      'BID_AWARD',
      'bid-award:synthetic-1',
      'active',
      '2027-01-01',
      '2027-12-31',
      1,
      1,
    );
    expect(() =>
      insertAssignment.run(
        'assignment-overlap',
        2,
        'slot-1',
        'BID_AWARD',
        'bid-award:synthetic-2',
        'planned',
        '2027-06-01',
        null,
        1,
        1,
      ),
    ).toThrow();
    expect(() =>
      insertAssignment.run(
        'assignment-sequential',
        2,
        'slot-1',
        'BID_AWARD',
        'bid-award:synthetic-3',
        'planned',
        '2028-01-01',
        null,
        1,
        1,
      ),
    ).not.toThrow();
    expect(() =>
      insertAssignment.run(
        'assignment-distinct-slot',
        1,
        'slot-2',
        'BID_AWARD',
        'bid-award:synthetic-4',
        'planned',
        '2027-06-01',
        null,
        1,
        1,
      ),
    ).toThrow(/overlapping authoritative assignment for member/);
    expect(() =>
      insertAssignment.run(
        'assignment-distinct-slot-sequential',
        1,
        'slot-2',
        'BID_AWARD',
        'bid-award:synthetic-5',
        'planned',
        '2028-01-01',
        null,
        1,
        1,
      ),
    ).not.toThrow();
    sqlite.close();
  });

  it('does not allow an import to be marked committed without recorded human approval', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('unapproved-commit', 'telestaff', 'sanitized-baseline', 'c'.repeat(64), 0, 'staged', 1);
    sqlite
      .prepare('UPDATE assignment_imports SET status = ? WHERE id = ?')
      .run('reviewed', 'unapproved-commit');

    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET status = ? WHERE id = ?')
        .run('approved', 'unapproved-commit'),
    ).toThrow();

    sqlite.close();
  });

  it('requires an approval timestamp as well as an approving member before commit', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'timestampless-commit',
        'telestaff',
        'sanitized-baseline',
        'd'.repeat(64),
        0,
        'staged',
        1,
      );
    sqlite
      .prepare('UPDATE assignment_imports SET status = ? WHERE id = ?')
      .run('reviewed', 'timestampless-commit');

    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET status = ?, approved_by_member_id = ? WHERE id = ?')
        .run('approved', 1, 'timestampless-commit'),
    ).toThrow();

    sqlite.close();
  });

  it('accepts a committed import when both human approval fields are recorded', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('approved-commit', 'telestaff', 'sanitized-baseline', 'e'.repeat(64), 0, 'staged', 1);

    expect(() =>
      (() => {
        advanceImportToApproved(sqlite, 'approved-commit');
        commitApprovedImport(sqlite, 'approved-commit');
      })(),
    ).not.toThrow();

    sqlite.close();
  });

  it('does not allow the recorded approval to occur after a commit', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'late-approval-commit',
        'telestaff',
        'sanitized-baseline',
        'f'.repeat(64),
        0,
        'staged',
        1,
      );
    sqlite
      .prepare('UPDATE assignment_imports SET status = ? WHERE id = ?')
      .run('reviewed', 'late-approval-commit');
    sqlite
      .prepare(
        'UPDATE assignment_imports SET status = ?, approved_at = ?, approved_by_member_id = ? WHERE id = ?',
      )
      .run('approved', 3, 1, 'late-approval-commit');

    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET status = ?, committed_at = ? WHERE id = ?')
        .run('committed', 2, 'late-approval-commit'),
    ).toThrow();

    sqlite.close();
  });

  it('requires imports to follow the staged, reviewed, approved, committed lifecycle', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, status, created_at, approved_at, approved_by_member_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'direct-committed-import',
          'telestaff',
          'sanitized-baseline',
          'a'.repeat(64),
          'committed',
          1,
          2,
          1,
          3,
        ),
    ).toThrow();

    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('lifecycle-import', 'telestaff', 'sanitized-baseline', 'b'.repeat(64), 0, 'staged', 1);
    expect(() =>
      sqlite
        .prepare(
          'UPDATE assignment_imports SET status = ?, approved_at = ?, approved_by_member_id = ?, committed_at = ? WHERE id = ?',
        )
        .run('committed', 2, 1, 3, 'lifecycle-import'),
    ).toThrow();

    sqlite
      .prepare('UPDATE assignment_imports SET status = ? WHERE id = ?')
      .run('reviewed', 'lifecycle-import');
    expect(() =>
      sqlite
        .prepare(
          'UPDATE assignment_imports SET approved_at = ?, approved_by_member_id = ? WHERE id = ?',
        )
        .run(99, 1, 'lifecycle-import'),
    ).toThrow();
    sqlite
      .prepare(
        'UPDATE assignment_imports SET status = ?, approved_at = ?, approved_by_member_id = ? WHERE id = ?',
      )
      .run('approved', 2, 1, 'lifecycle-import');
    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET approved_at = ? WHERE id = ?')
        .run(99, 'lifecycle-import'),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE assignment_imports SET status = ?, committed_at = ? WHERE id = ?')
        .run('committed', 3, 'lifecycle-import'),
    ).not.toThrow();
    sqlite.close();
  });
});
