import readXlsxFile from 'read-excel-file/universal';
import { describe, expect, it, vi } from 'vitest';
import { buildShiftRoster } from '../../src/exports/shift-roster.js';
import { generateShiftViewPdf, renderShiftViewHtml } from '../../src/exports/shift-view-pdf.js';
import {
  generateShiftViewWorkbook,
  shiftViewPrintFeature,
  shiftViewWorkbookSheets,
} from '../../src/exports/shift-view-xlsx.js';
import { shiftViewColumns, shiftViewSummaries } from '../../src/exports/shift-view.js';
import type { CurrentStaffingReceipt } from '../../src/lib/current-staffing-source.js';
import { shiftExportFixture } from './helpers/shift-roster-fixture.js';

const mocks = vi.hoisted(() => {
  const page = {
    setJavaScriptEnabled: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    pdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
  return { page, browser, launch: vi.fn(async () => browser) };
});
vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: mocks.launch } }));

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('required fixture value missing');
  return value;
}

describe('Shift View station-board exports', () => {
  const chiefsFixture = () => {
    const input = shiftExportFixture();
    for (const [index, shift] of (['A', 'B', 'C'] as const).entries()) {
      const id = index + 4;
      input.snapshot.members.push({
        ...required(input.snapshot.members[0]),
        memberId: id,
        pool: 'EXCLUDED',
        exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        rank: index === 1 ? 'CPT' : 'DC',
      });
      input.snapshot.operatorIdentityProjection?.push({
        memberId: id,
        employeeId: `CHIEF_${shift}`,
        firstName: `Chief ${shift}`,
        lastName: 'Saved',
        rank: index === 1 ? 'CPT' : 'DC',
      });
      input.snapshot.ruleBookMaterial.positions.push({
        ...required(input.snapshot.ruleBookMaterial.positions[0]),
        id: `${shift}211`,
        shift,
        station: 'Station #2',
        unit: '300',
        positionName: 'Division Chief',
        rankRequired: 'DC',
        bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        division: 'Combat',
        isFloating: false,
      });
    }
    const currentStaffing: CurrentStaffingReceipt = {
      archive: {
        v: 1,
        source: { name: 'mbfd_directory.csv', sha256: 'a'.repeat(64) },
        snapshotAt: '2026-10-04T00:00:00.000Z',
        rows: (['A', 'B', 'C'] as const).map((shift, index) => ({
          employeeId: `CHIEF_${shift}`,
          sourceRank: index === 1 ? 'Captain' : 'Division Chief',
          shift,
          aDayGroup: index === 0 ? 'G4' : index === 1 ? 'G2' : 'G3',
          station: 'Division Chief',
          unit: 'Division Chief 300',
          positionLabel: 'Division Chief',
          sourceRow: index + 2,
        })),
      },
      sha256: 'b'.repeat(64),
      publishedAt: '2026-10-04T01:00:00.000Z',
      publishedBy: 'operator',
    };
    return { ...input, currentStaffing };
  };

  it('adds only exact current Chief 300 occupants to administrative seats, preserving bid awards', () => {
    const roster = buildShiftRoster(chiefsFixture());
    for (const shift of roster.shifts.filter((shift) => shift.shift !== 'D')) {
      const chief = shift.stations
        .flatMap((station) => station.rows)
        .find((row) => row.positionId === `${shift.shift}211`);
      expect(chief).toMatchObject({
        member: `Chief ${shift.shift} Saved`,
        rank: 'DC',
        status: 'Not biddable',
        administrativeAssignment: true,
        markers: ['Admin assigned'],
      });
      expect(chief?.aDay).toBe(
        shift.shift === 'A' ? 'Group 4' : shift.shift === 'B' ? 'Group 2' : 'Group 3',
      );
    }
    // B chief's source rank never changes the frozen official rank or the role count.
    expect(
      roster.shifts[1]?.stations
        .flatMap((station) => station.rows)
        .find((row) => row.positionId === 'B211')?.memberRank,
    ).toBe('CPT');
    expect(roster.shifts[0]?.selected).toBe(1);
    expect(roster.shifts[0]?.available).toBe(1);
    expect(
      roster.shifts[0]?.stations[0]?.rows.find((row) => row.positionId === 'A101')?.member,
    ).toBe('Frozen <Captain> Member & Saved');
    expect(
      shiftViewSummaries(required(roster.shifts[0])).find((summary) => summary.label === 'RANK')
        ?.values,
    ).toContainEqual(['Division Chief', 1]);
  });

  it('skips ambiguous current-chief rows, missing frozen identities and future directory dates', () => {
    const ambiguous = chiefsFixture();
    ambiguous.currentStaffing.archive.rows.push({
      ...required(ambiguous.currentStaffing.archive.rows[0]),
      employeeId: 'OTHER',
    });
    expect(
      buildShiftRoster(ambiguous)
        .shifts[0]?.stations.flatMap((station) => station.rows)
        .find((row) => row.positionId === 'A211')?.member,
    ).toBeNull();
    const missing = chiefsFixture();
    missing.snapshot.operatorIdentityProjection =
      missing.snapshot.operatorIdentityProjection?.filter(
        (identity) => identity.employeeId !== 'CHIEF_A',
      ) ?? [];
    expect(
      buildShiftRoster(missing)
        .shifts[0]?.stations.flatMap((station) => station.rows)
        .find((row) => row.positionId === 'A211')?.member,
    ).toBeNull();
    const future = chiefsFixture();
    future.currentStaffing.archive.snapshotAt = '2026-10-05T00:00:00.000Z';
    expect(buildShiftRoster(future).currentStaffing).toBeUndefined();
    const conflictingStation = chiefsFixture();
    required(conflictingStation.currentStaffing.archive.rows[0]).station = 'Station #1';
    expect(
      buildShiftRoster(conflictingStation)
        .shifts[0]?.stations.flatMap((station) => station.rows)
        .find((row) => row.positionId === 'A211')?.member,
    ).toBeNull();
  });

  it('does not replace canonical temporary Chief 300 duties with directory occupants', () => {
    const input = chiefsFixture();
    input.state.live.exceptionalAssignments.push({
      ...required(input.state.live.exceptionalAssignments[0]),
      assignmentId: 'chief-duty',
      commandId: 'chief-command',
      positionId: 'A211',
      roleLabel: 'Division Chief',
    });
    const row = buildShiftRoster(input)
      .shifts[0]?.stations.flatMap((station) => station.rows)
      .find((row) => row.positionId === 'A211');
    expect(row?.member).toBeNull();
    expect(row?.temporaryDuties).toEqual(['Frozen 3 Member & Saved - Division Chief']);
    expect(row?.administrativeAssignment).toBeUndefined();
  });
  it('preserves every saved seat exactly once when arranging stations and pools', () => {
    const base = buildShiftRoster(shiftExportFixture()).shifts[0];
    if (!base) throw new Error('missing shift');
    const baseRow = required(base.stations[0]?.rows[0]);
    const shift = {
      ...base,
      stations: [
        ...['1', '2', '3', '4', '6'].map((station, index) => ({
          station,
          rows: [{ ...baseRow, positionId: `A${index}01` }],
        })),
        ...['Marine Float Pool', 'Rescue Float Pool', 'Combat Float Pool', 'Union President'].map(
          (station, index) => ({
            station,
            rows: [{ ...baseRow, positionId: `A8${index}1` }],
          }),
        ),
      ],
    };
    const columns = shiftViewColumns(shift);
    expect(columns).toHaveLength(6);
    expect(columns[4]?.map((block) => block.station)).toEqual([
      '6',
      'Marine Float Pool',
      'Union President',
    ]);
    expect(columns[5]?.map((block) => block.station)).toEqual([
      'Rescue Float Pool',
      'Combat Float Pool',
    ]);
    expect(
      columns
        .flatMap((column) => column.flatMap((block) => block.rows.map((row) => row.positionId)))
        .sort(),
    ).toEqual(
      shift.stations.flatMap((station) => station.rows.map((row) => row.positionId)).sort(),
    );
  });

  it('places named Days units side by side without losing or duplicating seats', () => {
    const roster = buildShiftRoster(shiftExportFixture());
    const base = required(roster.shifts.find((shift) => shift.shift === 'D'));
    const row = required(base.stations[0]?.rows[0]);
    const shift = {
      ...base,
      stations: [
        {
          station: 'Days',
          rows: [
            { ...row, positionId: 'D101', unit: 'Prevention' },
            { ...row, positionId: 'D102', unit: 'Special Events' },
            { ...row, positionId: 'D104', unit: 'Special Events' },
            { ...row, positionId: 'D103', unit: 'Public Education' },
          ],
        },
      ],
    };
    const columns = shiftViewColumns(shift);
    expect(columns).toHaveLength(3);
    expect(columns.flatMap((column) => column.map((block) => block.station))).toEqual([
      'Days / Prevention',
      'Days / Special Events',
      'Days / Public Education',
    ]);
    expect(
      columns
        .flatMap((column) => column.flatMap((block) => block.rows.map((row) => row.positionId)))
        .sort(),
    ).toEqual(['D101', 'D102', 'D103', 'D104']);
  });

  it('exports real Excel sheets with station bands, literal strings and all award markers', async () => {
    const roster = buildShiftRoster(shiftExportFixture());
    const sheets = await readXlsxFile(
      await (await generateShiftViewWorkbook(roster)).arrayBuffer(),
    );
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(['A Shift', 'B Shift', 'C Shift', 'Days']);
    const cells = sheets.flatMap((sheet) => sheet.data.flat());
    for (const positionId of ['A101', 'A102', 'B101', 'C999', 'D101'])
      expect(cells.filter((cell) => cell === positionId)).toHaveLength(1);
    expect(cells).toContain('Frozen <Captain> Member & Saved\n[Forced]');
    expect(cells).toContain('Due');
    expect(JSON.stringify(sheets)).toContain('Due = Deferred A-Day');
    expect(cells).toContain('GR2');
    expect(cells).toContain('Temporary: Frozen 3 Member & Saved - Division Chief of Prevention');
    expect(cells).toContain('=HYPERLINK("https://invalid.example")');
    expect(JSON.stringify(sheets)).not.toMatch(
      /PRIVATE_EMPLOYEE|DO_NOT_EXPORT_PRIVATE_QUALIFICATION/,
    );
  });

  it('keeps a small single-station sheet inside its exact print range', () => {
    for (const sheet of shiftViewWorkbookSheets(buildShiftRoster(shiftExportFixture()))) {
      for (const row of sheet.data) expect(row.length).toBeLessThanOrEqual(sheet.columns.length);
      const spans = sheet.data
        .flat()
        .filter((cell) => cell && typeof cell === 'object' && 'columnSpan' in cell);
      for (const cell of spans)
        expect((cell as { columnSpan?: number }).columnSpan).toBeGreaterThan(0);
    }
  });

  it('uses Tabloid paper, one-page scaling and an exact used-cell print area', () => {
    const sheets = shiftViewWorkbookSheets(buildShiftRoster(shiftExportFixture()));
    const feature = shiftViewPrintFeature(sheets);
    const worksheet = feature.files?.transform?.['xl/worksheets/sheet{id}.xml']?.transform;
    const workbook = feature.files?.transform?.['xl/workbook.xml']?.transform;
    if (!worksheet || !workbook) throw new Error('missing print feature');
    const xml = worksheet(
      '<worksheet><sheetViews/><sheetData/><pageMargins left="1"/><pageSetup orientation="landscape"/></worksheet>',
      required(sheets[0]),
      { sheetIndex: 0, sheetId: '1' },
    );
    expect(xml).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(xml).toContain('paperSize="3" orientation="landscape" fitToWidth="1" fitToHeight="1"');
    expect(xml).toContain('left="0.25" right="0.25"');
    expect(xml.indexOf('<sheetPr>')).toBeLessThan(xml.indexOf('<sheetViews'));
    expect(xml.indexOf('<pageMargins')).toBeLessThan(xml.indexOf('<pageSetup'));
    const bookXml = workbook('<workbook><bookViews/><sheets/></workbook>', sheets, {});
    expect(bookXml.match(/name="_xlnm.Print_Area"/g)).toHaveLength(4);
    expect(bookXml).toMatch(/'A Shift'!\$A\$1:\$F\$\d+/);
    expect(bookXml).toMatch(/'Days'!\$A\$1:\$F\$\d+/);
  });

  it('uses the actual occupied seat rank for a rank override and retains missing metadata honestly', () => {
    const roster = buildShiftRoster(shiftExportFixture());
    const shift = required(roster.shifts[0]);
    const row = required(shift.stations[0]?.rows[0]);
    row.memberRank = 'FF';
    const rank = shiftViewSummaries(shift).find((summary) => summary.label === 'RANK');
    expect(rank?.values).toContainEqual(['Captain', 1]);
    expect(rank?.values).toContainEqual(['Firefighter', 0]);
    expect(
      shiftViewSummaries(shift).find((summary) => summary.label === 'DIVISION')?.values,
    ).toEqual([['Saved division detail', 'Unavailable']]);
  });

  it('counts abbreviated AT and INV occupied seats without merging their role and unit labels', () => {
    const roster = buildShiftRoster(shiftExportFixture());
    const shift = required(roster.shifts[0]);
    const row = required(shift.stations[0]?.rows[0]);
    const station = required(shift.stations[0]);
    station.rows = [
      { ...row, positionId: 'A203', rank: 'FF', position: 'Firefighter #1 AT', unit: 'Engine 2' },
      { ...row, positionId: 'A305', rank: 'FF', position: 'Firefighter#1INV', unit: 'Combat 3' },
    ];
    const specialty = shiftViewSummaries(shift).find(
      (summary) => summary.label === 'SPECIALTY SEATS',
    );
    expect(specialty?.values).toContainEqual(['Air Tech 810', 1]);
    expect(specialty?.values).toContainEqual(['Investigator', 1]);
  });

  it('renders escaped station-board HTML and one explicit sheet for each requested shift', () => {
    const html = renderShiftViewHtml(buildShiftRoster(shiftExportFixture()));
    expect(html.match(/class="shift-view"/g)).toHaveLength(4);
    expect(html).toContain('size:17in 11in');
    expect(html).toContain('Frozen &lt;Captain&gt; Member &amp; Saved');
    expect(html).toContain('[Forced]');
    expect(html).toContain('Deferred');
    expect(html).toContain('Due = Deferred A-Day');
    expect(html).toContain('class="aday">Due</td>');
    expect(html).toContain('GR2');
    expect(html).toContain('Temporary: Frozen 3 Member &amp; Saved');
    expect(html).toContain('print-color-adjust:exact');
    expect(html).not.toMatch(/PRIVATE_EMPLOYEE|<script|<iframe/);
  });

  it('renders one captured self-contained document and closes Browser Rendering after a failure', async () => {
    mocks.browser.close.mockClear();
    mocks.page.pdf.mockClear();
    const roster = buildShiftRoster(shiftExportFixture());
    await generateShiftViewPdf(roster, {} as never);
    expect(mocks.page.setContent).toHaveBeenCalledWith(renderShiftViewHtml(roster), {
      waitUntil: 'load',
      timeout: 30_000,
    });
    expect(mocks.page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'Tabloid',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
      }),
    );
    mocks.page.pdf.mockRejectedValueOnce(new Error('renderer unavailable'));
    await expect(generateShiftViewPdf(roster, {} as never)).rejects.toThrow('renderer unavailable');
    expect(mocks.browser.close).toHaveBeenCalledTimes(2);
  });
});
