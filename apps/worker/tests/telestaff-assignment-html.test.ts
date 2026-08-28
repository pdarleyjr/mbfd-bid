import { describe, expect, expectTypeOf, it } from 'vitest';

import { parseTeleStaffAssignmentsHtml } from '../src/lib/telestaff-assignment-html.js';
import {
  FUTURE_A_R_DAY_COUNTS,
  FUTURE_HTML_EXPECTATIONS,
  FUTURE_HTML_SHIFT_COUNTS,
  ORIGINAL_SHIFT_COUNTS,
  buildFutureTeleStaffAssignmentsHtml,
  buildOriginalTeleStaffAssignmentsHtml,
} from './fixtures/telestaff-assignments-html.js';

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce(
    (counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    },
    {} as Record<T, number>,
  );
}

function sourceBytes(html: string): Uint8Array {
  return new TextEncoder().encode(html);
}

describe('TeleStaff (EX) Export Assignments HTML adapter', () => {
  it('recognizes the semantic table, excludes a structural blank row, and preserves source-only observations', async () => {
    const result = await parseTeleStaffAssignmentsHtml(
      sourceBytes(buildFutureTeleStaffAssignmentsHtml()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sourceSystem).toBe('telestaff');
    expect(result.sourceFormat).toBe('TELSTAFF_ASSIGNMENTS_HTML_V1');
    expect(result.parserVersion).toMatch(/^telestaff-assignments-html@\d+$/);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.inputRowCount).toBe(FUTURE_HTML_EXPECTATIONS.totalRows);
    expect(result.normalizedDataRowCount).toBe(FUTURE_HTML_EXPECTATIONS.totalRows);
    expect(result.reportRowCount).toBe(
      FUTURE_HTML_EXPECTATIONS.totalRows + FUTURE_HTML_EXPECTATIONS.structuralBlankRows,
    );
    expect(result.uniqueEmployeeCount).toBe(FUTURE_HTML_EXPECTATIONS.uniqueEmployeeIds);
    expect(result.structuralRowCount).toBe(FUTURE_HTML_EXPECTATIONS.structuralBlankRows);
    const shifts = result.rows
      .map((row) => row.shift)
      .filter((shift): shift is string => shift !== null);
    expect(countBy(shifts)).toEqual(FUTURE_HTML_SHIFT_COUNTS);
    expect(result.rows.every((row) => !Object.hasOwn(row, 'effectiveFrom'))).toBe(true);
    expect(result.rows.every((row) => !Object.hasOwn(row, 'effectiveTo'))).toBe(true);
  });

  it('normalizes NBSP and hidden placeholder-only cells to null without dropping incomplete source rows', async () => {
    const result = await parseTeleStaffAssignmentsHtml(
      sourceBytes(buildFutureTeleStaffAssignmentsHtml()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.filter((row) => row.unit === null)).toHaveLength(
      FUTURE_HTML_EXPECTATIONS.missingUnitRows,
    );
    expect(result.rows.filter((row) => row.position === null)).toHaveLength(
      FUTURE_HTML_EXPECTATIONS.missingPositionRows,
    );
    expect(result.rows.filter((row) => row.sourceARDay === null)).toHaveLength(
      FUTURE_HTML_EXPECTATIONS.missingARDayRows,
    );
    expect(
      result.rows.filter(
        (row) => (row.unit === null || row.position === null) && row.employeeId !== null,
      ),
    ).not.toHaveLength(0);
    expect(result.rows.filter((row) => row.topologyCompleteness === 'incomplete')).not.toHaveLength(
      0,
    );
    expect(JSON.stringify(result.rows)).not.toContain('placeholder only');
    expect(JSON.stringify(result.rows)).not.toContain('&nbsp;');
  });

  it('preserves the six-seat Station 6 source topology for every A/B/C shift', async () => {
    const result = await parseTeleStaffAssignmentsHtml(
      sourceBytes(buildFutureTeleStaffAssignmentsHtml()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const shift of ['A Shift', 'B Shift', 'C Shift'] as const) {
      const stationSix = result.rows.filter((row) => row.shift === shift && row.station === '6');
      expect(stationSix).toHaveLength(6);
      expect(stationSix.map((row) => `${row.unit}/${row.position}`).sort()).toEqual([
        'Fire Boat 6/Marine Captain',
        'Fire Boat 6/Marine Deckhand',
        'Fire Boat 6/Marine Engineer',
        'Fire Boat 6/Marine Operator',
        'Marine Float/Marine Floater',
        'Marine Float/Marine Floater',
      ]);
    }
  });

  it('preserves one Suppression/Rescue Division Chief source observation per A/B/C shift without inferring a canonical slot', async () => {
    const result = await parseTeleStaffAssignmentsHtml(
      sourceBytes(buildFutureTeleStaffAssignmentsHtml()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const shift of ['A Shift', 'B Shift', 'C Shift'] as const) {
      const divisionChiefs = result.rows.filter(
        (row) =>
          row.shift === shift &&
          row.division === 'Suppression/Rescue' &&
          row.position === 'Division Chief',
      );
      expect(divisionChiefs).toHaveLength(1);
      expect(divisionChiefs[0]?.topologyCompleteness).toBe('complete');
    }
    expect(JSON.stringify(result.rows)).not.toContain('A211');
    expect(JSON.stringify(result.rows)).not.toContain('B211');
    expect(JSON.stringify(result.rows)).not.toContain('C211');
  });

  it('keeps A/R-day counts as source observations rather than annual capacity', async () => {
    const result = await parseTeleStaffAssignmentsHtml(
      sourceBytes(buildFutureTeleStaffAssignmentsHtml()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const [shift, expected] of Object.entries(FUTURE_A_R_DAY_COUNTS)) {
      const observed = result.rows
        .filter((row) => row.shift === shift && row.sourceARDay !== null)
        .map((row) => row.sourceARDay as keyof typeof expected);
      expect(countBy(observed)).toEqual(expected);
    }
    const d410 = result.rows.filter((row) => row.shift === 'D Shift 4/10');
    const d58 = result.rows.filter((row) => row.shift === 'D Shift 5/8');
    expect(d410.filter((row) => row.sourceARDay === null)).toHaveLength(3);
    expect(d58.filter((row) => row.sourceARDay === null)).toHaveLength(1);
    expect(d410.some((row) => row.sourceARDay === 'Mondays Off')).toBe(true);
    expect(d58.some((row) => row.sourceARDay === 'Saturday & Sunday Off')).toBe(true);
  });

  it('fails closed for missing or duplicated semantic headers', async () => {
    const html = buildFutureTeleStaffAssignmentsHtml();
    const missingEmployeeId = await parseTeleStaffAssignmentsHtml(
      sourceBytes(html.replace('Emp&nbsp;ID', 'Employee Identifier')),
    );
    const duplicateEmployeeId = await parseTeleStaffAssignmentsHtml(
      sourceBytes(html.replace('<th>Shift</th>', '<th>Emp ID</th>')),
    );
    const duplicateHeaderRow = await parseTeleStaffAssignmentsHtml(
      sourceBytes(
        html.replace(
          '<tbody>',
          '<tbody><tr><th>Name</th><th>Emp ID</th><th>Shift</th><th>Division</th><th>Station</th><th>Unit</th><th>Position</th><th>A/R Day</th></tr>',
        ),
      ),
    );

    expect(missingEmployeeId).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT',
    });
    expect(duplicateEmployeeId).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT',
    });
    expect(duplicateHeaderRow).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT',
    });
  });

  it('preserves a leading-zero Emp ID as opaque source text', async () => {
    const result = await parseTeleStaffAssignmentsHtml(
      sourceBytes(buildFutureTeleStaffAssignmentsHtml().replace('SYNTH-000001', '000123')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.employeeId).toBe('000123');
  });

  it('does not erase visible aria-hidden source text or treat script/style placeholders as topology', async () => {
    const html = buildFutureTeleStaffAssignmentsHtml()
      .replace('<span>SYNTH-000001</span>', '<span aria-hidden="true">SYNTH-000001</span>')
      .replace(
        '<div style="display: none">placeholder only</div>&nbsp;',
        '<script>placeholder only</script><style>.placeholder{display:none}</style>&nbsp;',
      );
    const result = await parseTeleStaffAssignmentsHtml(sourceBytes(html));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.employeeId).toBe('SYNTH-000001');
    expect(result.rows.filter((row) => row.unit === null)).toHaveLength(
      FUTURE_HTML_EXPECTATIONS.missingUnitRows,
    );
  });

  it('hashes exact supplied source bytes and accepts the original historical fixture independently', async () => {
    const originalHtml = buildOriginalTeleStaffAssignmentsHtml();
    const originalBytes = sourceBytes(originalHtml);
    const result = await parseTeleStaffAssignmentsHtml(originalBytes);
    const withUtf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...originalBytes]);
    const bomResult = await parseTeleStaffAssignmentsHtml(withUtf8Bom);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(bomResult.ok).toBe(true);
    if (!bomResult.ok) return;
    expect(bomResult.sourceHash).not.toBe(result.sourceHash);
    expect(result.inputRowCount).toBe(262);
    expect(result.structuralRowCount).toBe(0);
    expect(
      countBy(
        result.rows
          .map((row) => row.shift)
          .filter((shift): shift is keyof typeof ORIGINAL_SHIFT_COUNTS => shift !== null),
      ),
    ).toEqual(ORIGINAL_SHIFT_COUNTS);
  });

  it('fails closed instead of silently collapsing duplicate Emp ID source rows', async () => {
    const html = buildFutureTeleStaffAssignmentsHtml();
    const duplicateEmployeeId = await parseTeleStaffAssignmentsHtml(
      sourceBytes(html.replace('SYNTH-000262', 'SYNTH-000261')),
    );

    expect(duplicateEmployeeId).toMatchObject({
      ok: false,
      code: 'DUPLICATE_SOURCE_ROW_IDENTITY',
    });
  });

  it('ignores a hidden semantic-table decoy instead of treating it as a source candidate', async () => {
    const html = buildFutureTeleStaffAssignmentsHtml();
    const table = html.match(/<table id="__bookmark_1"[\s\S]*?<\/table>/)?.[0];
    expect(table).toBeDefined();
    if (table === undefined) return;
    const hiddenDecoy = table.replace('<table ', '<table hidden ');
    const result = await parseTeleStaffAssignmentsHtml(
      sourceBytes(html.replace('</body>', `${hiddenDecoy}</body>`)),
    );

    expect(result).toMatchObject({ ok: true, inputRowCount: FUTURE_HTML_EXPECTATIONS.totalRows });
  });

  it('requires source bytes and rejects a semantic header hidden by an ancestor', async () => {
    expectTypeOf<Parameters<typeof parseTeleStaffAssignmentsHtml>[0]>().toEqualTypeOf<Uint8Array>();

    const html = buildFutureTeleStaffAssignmentsHtml().replace('<thead>', '<thead hidden>');
    const result = await parseTeleStaffAssignmentsHtml(sourceBytes(html));

    expect(result).toEqual({
      ok: false,
      code: 'UNSUPPORTED_OR_AMBIGUOUS_SOURCE_FORMAT',
    });
  });
});
