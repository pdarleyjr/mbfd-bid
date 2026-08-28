import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '../../src/db/index.js';
import { evaluateTeleStaffImportCompleteness } from '../../src/lib/authoritative-staffing-baseline.js';
import { parseTeleStaffAssignmentsHtml } from '../../src/lib/telestaff-assignment-html.js';
import { stageParsedTeleStaffAssignmentsHtml } from '../../src/lib/telestaff-assignment-import.js';
import {
  FUTURE_HTML_EXPECTATIONS,
  buildFutureTeleStaffAssignmentsHtml,
} from '../fixtures/telestaff-assignments-html.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);
const SYNTHETIC_IMPORT_ID = '01M14RZDFMKK8S84K4Y2VD8VA0';

describe('TeleStaff HTML source persistence boundary', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('persists only sanitized source evidence, preserves every data row, and leaves reconciliation fail-closed', async () => {
    const parsed = await parseTeleStaffAssignmentsHtml(
      new TextEncoder().encode(buildFutureTeleStaffAssignmentsHtml()),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const staged = await stageParsedTeleStaffAssignmentsHtml(h.env.DB, parsed, {
      importId: SYNTHETIC_IMPORT_ID,
      sourceKind: 'synthetic_test',
      importedAtMs: NOW,
      hmacEmployeeReference: async (employeeId) => employeeId.replace(/\D/g, '').padStart(64, '0'),
      hmacRowFingerprint: async (canonicalSourceRow) =>
        String(JSON.parse(canonicalSourceRow).employeeId).replace(/\D/g, '').padStart(64, 'f'),
    });

    expect(staged).toEqual({
      ok: true,
      importId: SYNTHETIC_IMPORT_ID,
      sourceFormat: 'TELSTAFF_ASSIGNMENTS_HTML_V1',
      sourceKind: 'synthetic_test',
      inputRowCount: FUTURE_HTML_EXPECTATIONS.totalRows,
      reportRowCount:
        FUTURE_HTML_EXPECTATIONS.totalRows + FUTURE_HTML_EXPECTATIONS.structuralBlankRows,
      structuralRowCount: FUTURE_HTML_EXPECTATIONS.structuralBlankRows,
    });
    const manifest = await h.db.run(
      `SELECT source_format, parser_version, source_kind, input_row_count, normalized_data_row_count,
              unique_employee_count, report_row_count, structural_row_count, source_snapshot_as_of
       FROM assignment_imports WHERE id = ?`,
      [SYNTHETIC_IMPORT_ID],
    );
    expect(manifest.results).toEqual([
      {
        source_format: 'TELSTAFF_ASSIGNMENTS_HTML_V1',
        parser_version: 'telestaff-assignments-html@1',
        source_kind: 'synthetic_test',
        input_row_count: FUTURE_HTML_EXPECTATIONS.totalRows,
        normalized_data_row_count: FUTURE_HTML_EXPECTATIONS.totalRows,
        unique_employee_count: FUTURE_HTML_EXPECTATIONS.uniqueEmployeeIds,
        report_row_count:
          FUTURE_HTML_EXPECTATIONS.totalRows + FUTURE_HTML_EXPECTATIONS.structuralBlankRows,
        structural_row_count: FUTURE_HTML_EXPECTATIONS.structuralBlankRows,
        source_snapshot_as_of: null,
      },
    ]);
    const counts = await h.db.run(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN source_topology_completeness = 'incomplete' THEN 1 ELSE 0 END)
           AS incomplete_rows,
         SUM(CASE WHEN reconciliation_classification = 'AMBIGUOUS_MAPPING' THEN 1 ELSE 0 END)
           AS pending_complete_rows
       FROM assignment_import_rows WHERE import_id = ?`,
      [SYNTHETIC_IMPORT_ID],
    );
    expect(counts.results).toEqual([
      {
        source_rows: FUTURE_HTML_EXPECTATIONS.totalRows,
        incomplete_rows: FUTURE_HTML_EXPECTATIONS.missingPositionRows,
        pending_complete_rows:
          FUTURE_HTML_EXPECTATIONS.totalRows - FUTURE_HTML_EXPECTATIONS.missingPositionRows,
      },
    ]);
    const aRDayAccounting = await h.db.run(
      `SELECT COUNT(*) AS source_rows,
              SUM(CASE WHEN source_a_r_day IS NULL THEN 1 ELSE 0 END) AS missing_a_r_day_rows
         FROM assignment_import_rows
        WHERE import_id = ?`,
      [SYNTHETIC_IMPORT_ID],
    );
    expect(aRDayAccounting.results).toEqual([
      {
        source_rows: FUTURE_HTML_EXPECTATIONS.totalRows,
        missing_a_r_day_rows: FUTURE_HTML_EXPECTATIONS.missingARDayRows,
      },
    ]);
    expect(
      JSON.stringify(
        await h.db.run("SELECT sql FROM sqlite_master WHERE name = 'assignment_import_rows'"),
      ),
    ).not.toContain('Synthetic Member');
    expect(JSON.stringify(manifest)).not.toContain('SYNTH-');
    const persistedFingerprints = await h.db.run(
      'SELECT row_fingerprint FROM assignment_import_rows WHERE import_id = ? ORDER BY source_row_number',
      [SYNTHETIC_IMPORT_ID],
    );
    expect(persistedFingerprints.results.map((row) => row.row_fingerprint)).not.toContain(
      parsed.rows[0]?.transientDuplicateFingerprint,
    );
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM staffing_positions) AS staffing_positions,
             (SELECT COUNT(*) FROM assignment_observations) AS observations,
             (SELECT COUNT(*) FROM member_assignments) AS canonical_assignments,
             (SELECT COUNT(*) FROM portal_writeback_queue) AS portal_work`,
        )
      ).results,
    ).toEqual([
      {
        staffing_positions: 0,
        observations: 0,
        canonical_assignments: 0,
        portal_work: 0,
      },
    ]);

    const validation = await evaluateTeleStaffImportCompleteness(
      getDb(h.env.DB),
      SYNTHETIC_IMPORT_ID,
    );
    expect(validation).toMatchObject({
      status: 'BLOCKED',
      sourceRowCount: FUTURE_HTML_EXPECTATIONS.totalRows,
      incompleteTopologyCount: FUTURE_HTML_EXPECTATIONS.missingPositionRows,
      observationCount: 0,
      canonicalAssignmentCount: 0,
      blockingCodes: expect.arrayContaining(['IMPORT_NOT_COMMITTED', 'AMBIGUOUS_MAPPING']),
    });
  }, 15_000);

  it('fails before persistence when a supplied HMAC adapter cannot produce an opaque reference', async () => {
    const parsed = await parseTeleStaffAssignmentsHtml(
      new TextEncoder().encode(buildFutureTeleStaffAssignmentsHtml()),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const staged = await stageParsedTeleStaffAssignmentsHtml(h.env.DB, parsed, {
      importId: '01M14RZDFMKK8S84K4Y2VD8VA1',
      sourceKind: 'synthetic_test',
      importedAtMs: NOW,
      hmacEmployeeReference: async () => 'not-a-valid-hmac',
      hmacRowFingerprint: async () => 'a'.repeat(64),
    });

    expect(staged).toEqual({ ok: false, code: 'INVALID_EMPLOYEE_REFERENCE_HMAC' });
    expect(
      (
        await h.db.run(
          "SELECT COUNT(*) AS count FROM assignment_imports WHERE id = '01M14RZDFMKK8S84K4Y2VD8VA1'",
        )
      ).results,
    ).toEqual([{ count: 0 }]);
  });

  it('fails before persistence when the row-fingerprint HMAC operation throws', async () => {
    const parsed = await parseTeleStaffAssignmentsHtml(
      new TextEncoder().encode(buildFutureTeleStaffAssignmentsHtml()),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const staged = await stageParsedTeleStaffAssignmentsHtml(h.env.DB, parsed, {
      importId: '01M14RZDFMKK8S84K4Y2VD8VA2',
      sourceKind: 'synthetic_test',
      importedAtMs: NOW,
      hmacEmployeeReference: async (employeeId) => employeeId.replace(/\D/g, '').padStart(64, '0'),
      hmacRowFingerprint: async () => {
        throw new Error('test HMAC failure');
      },
    });

    expect(staged).toEqual({ ok: false, code: 'INVALID_ROW_FINGERPRINT_HMAC' });
    expect(
      (
        await h.db.run(
          "SELECT COUNT(*) AS count FROM assignment_imports WHERE id = '01M14RZDFMKK8S84K4Y2VD8VA2'",
        )
      ).results,
    ).toEqual([{ count: 0 }]);
  });
});
