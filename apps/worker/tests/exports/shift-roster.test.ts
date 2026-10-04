import readXlsxFile from 'read-excel-file/universal';
import { describe, expect, it, vi } from 'vitest';
import { generateShiftWorkbook } from '../../src/exports/shift-roster-xlsx.js';
import { buildShiftRoster, exportTimestamp } from '../../src/exports/shift-roster.js';
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
import { generateShiftPdf, renderShiftRosterHtml } from '../../src/exports/shift-roster-pdf.js';

describe('captured shift rosters', () => {
  it('labels captured times in the department timezone', () => {
    expect(exportTimestamp('2026-10-04T12:00:00.000Z')).toBe('Oct 4, 2026, 8:00 AM EDT');
    expect(exportTimestamp('2026-12-04T12:00:00.000Z')).toBe('Dec 4, 2026, 7:00 AM EST');
  });
  it('includes every saved seat, current awards, forced/deferred flags and temporary duties', () => {
    const roster = buildShiftRoster(shiftExportFixture());
    expect(roster.sequence).toBe(7);
    expect(roster.shifts.map((s) => [s.shift, s.positions, s.selected, s.available])).toEqual([
      ['A', 2, 1, 1],
      ['B', 1, 1, 0],
      ['C', 1, 0, 0],
      ['D', 1, 0, 1],
    ]);
    expect(roster.shifts[0]?.stations[0]?.rows[0]).toMatchObject({
      positionId: 'A101',
      member: 'Frozen <Captain> Member & Saved',
      aDay: 'Deferred',
      markers: ['Forced'],
    });
    expect(roster.shifts[1]?.stations[0]?.rows[0]?.aDay).toBe('Group 2');
    expect(roster.shifts[2]?.stations[0]?.rows[0]).toMatchObject({
      status: 'Not biddable',
      temporaryDuties: ['Frozen 3 Member & Saved - Division Chief of Prevention'],
    });
    expect(JSON.stringify(roster)).not.toMatch(
      /PRIVATE_EMPLOYEE|DO_NOT_EXPORT_PRIVATE_QUALIFICATION/,
    );
  });

  it.each(['A', 'B', 'C', 'D'] as const)('exports exactly the requested %s shift', (scope) => {
    const roster = buildShiftRoster({ ...shiftExportFixture(), scope });
    expect(roster.shifts.map((s) => s.shift)).toEqual([scope]);
  });

  it('does not fabricate identity for historical snapshots with no frozen names', () => {
    const input = shiftExportFixture();
    const { operatorIdentityProjection: _identities, ...snapshot } = input.snapshot;
    const roster = buildShiftRoster({ ...input, snapshot });
    expect(roster.shifts[0]?.stations[0]?.rows[0]?.member).toBe('Name unavailable in saved bid');
  });

  it('rejects duplicate members and unresolved awards even outside the requested shift', () => {
    const input = shiftExportFixture();
    input.state.fills.B101.memberId = 1;
    expect(() => buildShiftRoster({ ...input, scope: 'A' })).toThrow(
      'session_bid_reference_invalid',
    );
  });

  it('uses current canonical awards over stale legacy awards and retained presentation', () => {
    const input = shiftExportFixture();
    const roster = buildShiftRoster({
      ...input,
      state: { ...input.state, fills: {} },
      legacyAwards: [{ positionId: 'A101', memberId: 1, aDay: 'G1', forced: true }],
    });
    expect(roster.shifts.every((s) => s.selected === 0)).toBe(true);
  });

  it('creates a genuine multi-sheet Excel file with literal strings, open seats and A-Days', async () => {
    const blob = await generateShiftWorkbook(buildShiftRoster(shiftExportFixture()));
    const bytes = await blob.arrayBuffer();
    expect([...new Uint8Array(bytes).slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const sheets = await readXlsxFile(bytes);
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(['A Shift', 'B Shift', 'C Shift', 'Days']);
    expect(sheets[0]?.data.find((row) => row[0] === 'A101')).toEqual([
      'A101',
      'Engine 1',
      'Position A101',
      'CPT',
      'CPT Frozen <Captain> Member & Saved',
      'Deferred',
      'Selected',
      'Forced',
    ]);
    expect(sheets[0]?.data.find((row) => row[0] === 'A102')?.[1]).toBe(
      '=HYPERLINK("https://invalid.example")',
    );
    expect(sheets[1]?.data.find((row) => row[0] === 'B101')?.[5]).toBe('Group 2');
    expect(sheets[3]?.data.find((row) => row[0] === 'D101')?.[6]).toBe('Available');
    expect(JSON.stringify(sheets)).not.toMatch(
      /PRIVATE_EMPLOYEE|DO_NOT_EXPORT_PRIVATE_QUALIFICATION/,
    );
  });

  it('renders escaped, self-contained HTML with clear Mock and open-seat information', () => {
    const html = renderShiftRosterHtml(buildShiftRoster(shiftExportFixture()));
    expect(html).toContain('Frozen &lt;Captain&gt; Member &amp; Saved');
    expect(html).not.toContain('Frozen <Captain>');
    expect(html).toContain('MOCK REHEARSAL');
    expect(html).toContain('Deferred');
    expect(html).toContain('Group 2');
    expect(html).toContain('Available');
    expect(html).not.toMatch(
      /PRIVATE_EMPLOYEE|DO_NOT_EXPORT_PRIVATE_QUALIFICATION|<script|<iframe/,
    );
    expect(html.match(/<section class="shift">/g)).toHaveLength(4);
  });

  it('passes one captured document to Browser Rendering and closes it on failure', async () => {
    mocks.browser.close.mockClear();
    mocks.page.pdf.mockClear();
    const roster = buildShiftRoster(shiftExportFixture());
    await generateShiftPdf(roster, {} as never);
    expect(mocks.page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(mocks.page.setContent).toHaveBeenCalledWith(renderShiftRosterHtml(roster), {
      waitUntil: 'load',
      timeout: 30_000,
    });
    expect(mocks.page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        landscape: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: expect.stringContaining('MOCK REHEARSAL'),
        footerTemplate: expect.stringContaining('class="pageNumber"'),
      }),
    );
    const pdfOptions = (
      mocks.page.pdf.mock.calls as unknown as Array<
        [{ headerTemplate: string; footerTemplate: string }]
      >
    )[0]?.[0];
    expect(pdfOptions?.headerTemplate).toContain('Sequence 7');
    expect(pdfOptions?.footerTemplate).toContain(roster.sessionId);
    mocks.page.pdf.mockRejectedValueOnce(new Error('renderer unavailable'));
    await expect(generateShiftPdf(roster, {} as never)).rejects.toThrow('renderer unavailable');
    expect(mocks.browser.close).toHaveBeenCalledTimes(2);
  });
});
