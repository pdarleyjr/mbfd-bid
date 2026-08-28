import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '../../src/db/index.js';
import {
  evaluateAuthoritativeStaffingBaseline,
  evaluateTeleStaffImportCompleteness,
} from '../../src/lib/authoritative-staffing-baseline.js';
import { parseTeleStaffAssignmentsHtml } from '../../src/lib/telestaff-assignment-html.js';
import {
  FUTURE_HTML_EXPECTATIONS,
  ORIGINAL_SHIFT_COUNTS,
  buildFutureTeleStaffAssignmentsHtml,
  buildOriginalTeleStaffAssignments,
} from '../fixtures/telestaff-assignments-html.js';
import {
  type SyntheticBaselineRow,
  seedAuthoritativeBaseline,
} from './helpers/authoritative-staffing-baseline.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('authoritative TeleStaff staffing baseline completeness', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('blocks a multi-row source before it can be accepted when one resolved row lacks its observation', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'partial-observation',
      rows: [
        { sourceRowNumber: 1, normalizedTopology: 'synthetic/one', materializeObservation: true },
        { sourceRowNumber: 2, normalizedTopology: 'synthetic/two', materializeObservation: false },
      ],
      accept: false,
    });

    const baseline = await evaluateTeleStaffImportCompleteness(
      getDb(h.env.DB),
      'partial-observation',
    );

    expect(baseline.status).toBe('BLOCKED');
    expect(baseline.inputRowCount).toBe(2);
    expect(baseline.observationCount).toBe(1);
    expect(baseline.missingObservations).toBe(1);
    expect(baseline.blockingCodes).toContain('MISSING_REQUIRED_OBSERVATION');
  });

  it('blocks partial source ingestion instead of treating a single persisted row as a complete manifest', async () => {
    const sourceRows: SyntheticBaselineRow[] = [
      { sourceRowNumber: 1, normalizedTopology: 'synthetic/one' },
      { sourceRowNumber: 2, normalizedTopology: 'synthetic/two' },
    ];
    const firstSourceRow = sourceRows[0];
    if (firstSourceRow === undefined) throw new Error('Synthetic source fixture is incomplete.');
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'partial-ingestion',
      rows: sourceRows,
      persistedRows: [firstSourceRow],
      inputRowCount: 2,
      normalizedDataRowCount: 2,
      uniqueEmployeeCount: 2,
      commit: false,
      accept: false,
    });

    const result = await evaluateTeleStaffImportCompleteness(getDb(h.env.DB), 'partial-ingestion');

    expect(result.status).toBe('BLOCKED');
    expect(result.sourceRowCount).toBe(1);
    expect(result.inputRowCount).toBe(2);
    expect(result.blockingCodes).toContain('SOURCE_ROW_COUNT_MISMATCH');
  });

  it('blocks unresolved incomplete topology while preserving its source row without a fabricated mapping', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'incomplete-pending',
      rows: [
        {
          sourceRowNumber: 1,
          normalizedTopology: '{"shift":"A Shift","unit":null,"position":null}',
          topologyCompleteness: 'incomplete',
          classification: 'INCOMPLETE_TOPOLOGY',
          reviewStatus: 'pending',
          materializeObservation: false,
        },
      ],
      commit: false,
      accept: false,
    });

    const result = await evaluateTeleStaffImportCompleteness(getDb(h.env.DB), 'incomplete-pending');

    expect(result.status).toBe('BLOCKED');
    expect(result.sourceRowCount).toBe(1);
    expect(result.incompleteTopologyCount).toBe(1);
    expect(result.unresolvedIncompleteTopology).toBe(1);
    expect(result.observationCount).toBe(0);
    expect(result.blockingCodes).toContain('UNRESOLVED_INCOMPLETE_TOPOLOGY');
  });

  it('keeps unknown employees and ambiguous mappings fail closed until they have a terminal reviewed action', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'unresolved-identities',
      rows: [
        {
          sourceRowNumber: 1,
          normalizedTopology: 'synthetic/unknown',
          classification: 'UNKNOWN_EMPLOYEE',
          reviewStatus: 'pending',
          materializeObservation: false,
        },
        {
          sourceRowNumber: 2,
          normalizedTopology: 'synthetic/ambiguous',
          classification: 'AMBIGUOUS_MAPPING',
          reviewStatus: 'pending',
          materializeObservation: false,
        },
      ],
      commit: false,
      accept: false,
    });

    const baseline = await evaluateTeleStaffImportCompleteness(
      getDb(h.env.DB),
      'unresolved-identities',
    );

    expect(baseline.status).toBe('BLOCKED');
    expect(baseline.unknownEmployees).toBe(1);
    expect(baseline.ambiguousMappings).toBe(1);
    expect(baseline.blockingCodes).toContain('UNKNOWN_EMPLOYEE');
    expect(baseline.blockingCodes).toContain('AMBIGUOUS_MAPPING');
  });

  it('accepts reviewed rejected unknown and ambiguous rows as immutable source evidence, not canonical mappings', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'reviewed-source-exceptions',
      rows: [
        {
          sourceRowNumber: 1,
          normalizedTopology: 'synthetic/unknown',
          classification: 'UNKNOWN_EMPLOYEE',
          materializeObservation: false,
        },
        {
          sourceRowNumber: 2,
          normalizedTopology: 'synthetic/ambiguous',
          classification: 'AMBIGUOUS_MAPPING',
          materializeObservation: false,
        },
      ],
    });

    const baseline = await evaluateAuthoritativeStaffingBaseline(getDb(h.env.DB), 2027);

    expect(baseline.status).toBe('PASS');
    expect(baseline.reviewedExceptionCount).toBe(2);
    expect(baseline.observationCount).toBe(0);
    expect(baseline.canonicalAssignmentCount).toBe(0);
    expect(baseline.unresolvedRows).toBe(0);
  });

  it('passes a complete multi-row source with an explicitly reviewed incomplete topology exception', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'complete-reviewed-exception',
      rows: [
        { sourceRowNumber: 1, normalizedTopology: 'synthetic/one' },
        {
          sourceRowNumber: 2,
          normalizedTopology: '{"shift":"D Shift 4/10","unit":null,"position":null}',
          topologyCompleteness: 'incomplete',
          classification: 'INCOMPLETE_TOPOLOGY',
          materializeObservation: false,
        },
        { sourceRowNumber: 3, normalizedTopology: 'synthetic/three', sourceARDay: null },
      ],
    });

    const baseline = await evaluateAuthoritativeStaffingBaseline(getDb(h.env.DB), 2027);

    expect(baseline.status).toBe('PASS');
    expect(baseline.inputRowCount).toBe(3);
    expect(baseline.resolvedRowCount).toBe(3);
    expect(baseline.incompleteTopologyCount).toBe(1);
    expect(baseline.unresolvedIncompleteTopology).toBe(0);
    expect(baseline.observationCount).toBe(2);
    expect(baseline.canonicalAssignmentCount).toBe(2);
    expect(baseline.blockingCodes).toEqual([]);
  });

  it('preserves the original 262-row fixture as distinct, complete source-format evidence', () => {
    const original = buildOriginalTeleStaffAssignments();
    const shiftCounts = original.reduce<Record<string, number>>((counts, row) => {
      counts[row.shift] = (counts[row.shift] ?? 0) + 1;
      return counts;
    }, {});

    expect(original).toHaveLength(262);
    expect(shiftCounts).toEqual(ORIGINAL_SHIFT_COUNTS);
    expect(new Set(original.map((row) => row.employeeId)).size).toBe(262);
    expect(original.every((row) => row.unit !== null && row.position !== null)).toBe(true);
  });

  it('accepts every future HTML source row without converting it into canonical capacity', async () => {
    const parsed = await parseTeleStaffAssignmentsHtml(
      new TextEncoder().encode(buildFutureTeleStaffAssignmentsHtml()),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.inputRowCount).toBe(FUTURE_HTML_EXPECTATIONS.totalRows);
    expect(parsed.rows.some((row) => row.topologyCompleteness === 'incomplete')).toBe(true);
    expect(parsed.rows.every((row) => !('staffingPositionId' in row))).toBe(true);
  });
});
