import writeXlsxFile, {
  type CellObject,
  type Feature,
  type SheetData,
} from 'write-excel-file/universal';
import {
  appendMarkupInsideElement,
  findElement,
  findElementInsideElement,
  getCellAddress,
  getOrderOfSiblings,
  insertElementMarkupAccordingToOrderOfSiblings,
  replaceElement,
  sanitizeTextContent,
} from 'write-excel-file/utility';
import { type ShiftRoster, exportTimestamp, shiftLabel } from './shift-roster.js';
import {
  SHIFT_VIEW_COLORS,
  shiftViewADay,
  shiftViewColumns,
  shiftViewOccupant,
  shiftViewOccupied,
  shiftViewStationLabel,
  shiftViewSummaries,
  shiftViewTitle,
  shiftViewUnitColor,
} from './shift-view.js';

const BORDER = { borderColor: '#111111', borderStyle: 'thin' as const };
// Explicit String prevents names/unit labels from becoming workbook formulas.
function cell(value: string | number, style: Partial<CellObject> = {}): CellObject {
  return { value: String(value), type: String, fontFamily: 'Arial', fontSize: 10, ...style };
}

export function shiftViewWorkbookSheets(roster: ShiftRoster) {
  return roster.shifts.map((shift, shiftIndex) => {
    const columns = shiftViewColumns(shift);
    const width = columns.length * 7 - 1;
    const data: SheetData = [];
    const put = (row: number, column: number, value: CellObject) => {
      while (data.length <= row) data.push([]);
      const target = data[row];
      if (!target) throw new Error('shift_view_row_missing');
      target[column] = value;
    };
    const full = (row: number, value: string, style: Partial<CellObject> = {}) =>
      put(row, 0, cell(value, { columnSpan: width, wrap: true, ...style }));
    full(0, `${shiftViewTitle(shift)}  |  MBFD ${roster.year}  |  Shift View`, {
      fontSize: 20,
      height: 32,
      fontWeight: 'bold',
      align: 'center',
      textColor: '#FFFFFF',
      backgroundColor: SHIFT_VIEW_COLORS[shift.shift],
    });
    full(
      1,
      `${roster.isMock ? 'MOCK REHEARSAL — Not for staffing assignments' : 'REAL BID — Progress at export time'} | Sequence ${roster.sequence} | ${roster.phase.replaceAll('_', ' ')}`,
      {
        height: 22,
        align: 'center',
        fontWeight: 'bold',
        textColor: roster.isMock ? '#B00000' : '#111111',
      },
    );
    const ends: number[] = [];
    for (const [columnIndex, blocks] of columns.entries()) {
      const start = columnIndex * 7;
      let rowIndex = 3;
      for (const block of blocks) {
        put(
          rowIndex++,
          start,
          cell(shiftViewStationLabel(block.station), {
            columnSpan: 6,
            height: 22,
            align: 'center',
            fontWeight: 'bold',
            backgroundColor: '#FFFF00',
            ...BORDER,
          }),
        );
        for (const unit of block.units) {
          put(
            rowIndex,
            start,
            cell(unit.unit, {
              rowSpan: unit.rows.length,
              textRotation: 90,
              align: 'center',
              alignVertical: 'center',
              fontWeight: 'bold',
              backgroundColor: shiftViewUnitColor(unit.unit),
              ...BORDER,
            }),
          );
          for (const row of unit.rows) {
            const occupant = shiftViewOccupant(row);
            const lines = Math.max(
              Math.ceil(row.position.length / 16),
              ...occupant.split('\n').map((line) => Math.ceil(line.length / 19)),
              occupant.split('\n').length,
              1,
            );
            const style: Partial<CellObject> = {
              height: Math.max(
                24,
                lines * 13 + 6,
                unit.rows.length === 1 ? unit.unit.length * 5.5 + 8 : 0,
              ),
              wrap: true,
              alignVertical: 'center',
              backgroundColor: block.rows.indexOf(row) % 2 ? '#D8D8D8' : '#FFFFFF',
              ...BORDER,
            };
            put(
              rowIndex,
              start + 1,
              cell(row.positionId, {
                ...style,
                textColor: '#0039C2',
                align: 'center',
                fontWeight: 'bold',
              }),
            );
            put(
              rowIndex,
              start + 2,
              cell(shiftViewOccupied(row) ? 1 : '', {
                ...style,
                wrap: false,
                textColor: '#CC0000',
                align: 'center',
              }),
            );
            put(rowIndex, start + 3, cell(row.position, style));
            put(rowIndex, start + 4, cell(occupant, style));
            put(rowIndex, start + 5, cell(shiftViewADay(row.aDay), { ...style, align: 'center' }));
            rowIndex++;
          }
        }
        const totalStyle: Partial<CellObject> = {
          backgroundColor: '#C5D9EC',
          fontWeight: 'bold',
          height: 22,
          ...BORDER,
        };
        put(rowIndex, start, cell('Total', { ...totalStyle, columnSpan: 2, align: 'center' }));
        put(
          rowIndex,
          start + 2,
          cell(block.rows.filter(shiftViewOccupied).length, {
            ...totalStyle,
            wrap: false,
            textColor: '#CC0000',
            align: 'center',
          }),
        );
        put(
          rowIndex++,
          start + 3,
          cell(`${block.rows.length} positions`, { ...totalStyle, columnSpan: 3, align: 'center' }),
        );
        rowIndex++;
      }
      ends.push(rowIndex);
    }
    const summaryStart = Math.max(4, ...ends) + 1;
    const summaries = shiftViewSummaries(shift);
    const summariesPerRow = Math.min(summaries.length, Math.max(1, Math.floor(width / 7)));
    // Align summary groups to the station stride. Otherwise a value can land in
    // the narrow seat-count column and wrap a two-digit total into two lines.
    const summaryWidth = Math.min(7, width);
    for (const [index, summary] of summaries.entries()) {
      const start = (index % summariesPerRow) * summaryWidth;
      const top = summaryStart + Math.floor(index / summariesPerRow) * 7;
      put(
        top,
        start,
        cell(summary.label, {
          columnSpan: summaryWidth - 1,
          height: 22,
          align: 'center',
          fontWeight: 'bold',
          backgroundColor: '#96CF50',
          ...BORDER,
        }),
      );
      for (const [offset, [label, value]] of summary.values.entries()) {
        const row = top + offset + 1;
        put(
          row,
          start,
          cell(value, {
            columnSpan: 2,
            height: typeof value === 'number' ? 22 : 30,
            wrap: typeof value !== 'number',
            align: 'center',
            textColor: '#CC0000',
            backgroundColor: '#FFFF00',
            ...BORDER,
          }),
        );
        put(
          row,
          start + 2,
          cell(label, {
            columnSpan: summaryWidth - 3,
            height: 22,
            wrap: true,
            fontWeight: 'bold',
            backgroundColor: '#FFFF00',
            ...BORDER,
          }),
        );
      }
    }
    let footerRow = summaryStart + Math.ceil(summaries.length / summariesPerRow) * 7 + 1;
    if (shiftIndex === roster.shifts.length - 1 && roster.unplacedTemporaryDuties.length) {
      const duties = `Temporary duties without a seat: ${roster.unplacedTemporaryDuties.join('; ')}`;
      full(footerRow++, duties, {
        height: Math.max(26, Math.ceil(duties.length / (width * 5)) * 14 + 10),
      });
    }
    full(
      footerRow++,
      `Captured ${exportTimestamp(roster.generatedAt)} | Session ${roster.sessionId} | Saved rule book ${roster.ruleBookVersion} | Configuration ${roster.configurationRevision}`,
      { fontSize: 9, height: 24 },
    );
    if (roster.currentStaffing)
      full(
        footerRow++,
        `Chief 300 current assignments: ${roster.currentStaffing.sourceName} (${exportTimestamp(roster.currentStaffing.snapshotAt)}).`,
        { fontSize: 9, height: 24 },
      );
    full(
      footerRow,
      'Empty bid seats are open. Admin assigned seats show current staffing when recorded. Due = Deferred A-Day. Forced and temporary duty markers are labelled.',
      { fontSize: 9, height: 24 },
    );
    // Each worksheet has the exact used width, without a trailing spacer column.
    const widths = Array.from(
      { length: width },
      (_, index) => [3, 6, 3, 16, 19, 5, 1][index % 7] ?? 1,
    );
    return {
      sheet: shiftLabel(shift.shift),
      data,
      orientation: 'landscape' as const,
      stickyRowsCount: 2,
      showGridLines: false,
      zoomScale: 70,
      columns: widths.map((value) => ({ width: value })),
    };
  });
}

/** Public write-excel-file Feature API adds the Open XML print properties that
 * its basic orientation option does not expose. No ZIP repair/dependency needed. */
export function shiftViewPrintFeature(
  sheets: ReturnType<typeof shiftViewWorkbookSheets>,
): Feature<Blob> {
  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform(content) {
            let xml = content;
            const sheetOrder = getOrderOfSiblings('xl/worksheets/sheet{id}.xml', 'worksheet') ?? [];
            const sheetPr = findElement(xml, 'sheetPr');
            const pagePr = sheetPr
              ? findElementInsideElement(xml, 'pageSetUpPr', sheetPr)
              : undefined;
            if (pagePr) xml = replaceElement(xml, pagePr, '<pageSetUpPr fitToPage="1"/>');
            else if (sheetPr)
              xml = appendMarkupInsideElement(xml, sheetPr, '<pageSetUpPr fitToPage="1"/>');
            else
              xml = insertElementMarkupAccordingToOrderOfSiblings(
                xml,
                '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
                sheetOrder,
                'worksheet',
              );
            const setup =
              '<pageSetup paperSize="3" orientation="landscape" fitToWidth="1" fitToHeight="1"/>';
            const existingSetup = findElement(xml, 'pageSetup');
            xml = existingSetup
              ? replaceElement(xml, existingSetup, setup)
              : insertElementMarkupAccordingToOrderOfSiblings(xml, setup, sheetOrder, 'worksheet');
            const margins =
              '<pageMargins left="0.25" right="0.25" top="0.25" bottom="0.25" header="0" footer="0"/>';
            const existingMargins = findElement(xml, 'pageMargins');
            return existingMargins
              ? replaceElement(xml, existingMargins, margins)
              : insertElementMarkupAccordingToOrderOfSiblings(
                  xml,
                  margins,
                  sheetOrder,
                  'worksheet',
                );
          },
        },
        'xl/workbook.xml': {
          transform(content) {
            const names = sheets
              .map((sheet, index) => {
                const lastRow = Math.max(0, sheet.data.length - 1);
                const lastColumn = Math.max(0, sheet.columns.length - 1);
                const area = `'${sheet.sheet.replaceAll("'", "''")}'!$A$1:$${getCellAddress(lastRow, lastColumn).replace(/(\D+)(\d+)/, '$1$$$2')}`;
                return `<definedName name="_xlnm.Print_Area" localSheetId="${index}">${sanitizeTextContent(area)}</definedName>`;
              })
              .join('');
            const existing = findElement(content, 'definedNames');
            return existing
              ? appendMarkupInsideElement(content, existing, names)
              : insertElementMarkupAccordingToOrderOfSiblings(
                  content,
                  `<definedNames>${names}</definedNames>`,
                  getOrderOfSiblings('xl/workbook.xml', 'workbook') ?? [],
                  'workbook',
                );
          },
        },
      },
    },
  };
}

export async function generateShiftViewWorkbook(roster: ShiftRoster): Promise<Blob> {
  const sheets = shiftViewWorkbookSheets(roster);
  return (await writeXlsxFile(sheets, { features: [shiftViewPrintFeature(sheets)] })).toBlob();
}
