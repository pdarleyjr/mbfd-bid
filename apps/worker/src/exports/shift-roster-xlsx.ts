import writeXlsxFile, { type CellObject, type SheetData } from 'write-excel-file/universal';
import { type ShiftRoster, exportTimestamp, shiftLabel } from './shift-roster.js';

const headers = ['Seat', 'Unit', 'Position', 'Rank', 'Member', 'A-Day', 'Status', 'Details'];

// Every external string is explicitly text. Names beginning with =, +, - or @
// remain literal cell values and can never create executable workbook formulas.
function textCell(value: string, style: Partial<CellObject> = {}): CellObject {
  return { value, ...style, type: String };
}

export function shiftWorkbookSheets(roster: ShiftRoster) {
  return roster.shifts.map((shift) => {
    const data: SheetData = [
      [
        textCell(
          `MBFD ${roster.year} - ${shiftLabel(shift.shift)} - ${roster.isMock ? 'MOCK BID' : 'REAL BID'}`,
          {
            columnSpan: 8,
            fontSize: 18,
            fontWeight: 'bold',
            textColor: '#FFFFFF',
            backgroundColor: '#17314F',
            height: 30,
          },
        ),
      ],
      [
        textCell(
          `${shift.positions} seats | ${shift.selected} selected | ${shift.available} available | Sequence ${roster.sequence} | ${roster.phase.replaceAll('_', ' ')}`,
          { columnSpan: 8 },
        ),
      ],
      [
        textCell(`Captured ${exportTimestamp(roster.generatedAt)} | Session ${roster.sessionId}`, {
          columnSpan: 8,
        }),
      ],
      [
        textCell(
          `Saved rule book ${roster.ruleBookVersion} | Configuration ${roster.configurationRevision} | Policy captured ${exportTimestamp(roster.snapshotCapturedAt)}`,
          { columnSpan: 8 },
        ),
      ],
      [
        textCell(
          roster.isMock
            ? 'MOCK REHEARSAL - Do not use for staffing assignments.'
            : 'Bid progress at export time. Open seats and deferred A-Days remain visible.',
          {
            columnSpan: 8,
            fontWeight: 'bold',
            textColor: roster.isMock ? '#B91C1C' : '#17314F',
          },
        ),
      ],
      headers.map((value) =>
        textCell(value, {
          fontWeight: 'bold',
          backgroundColor: '#E8EDF4',
          height: 24,
        }),
      ),
    ];
    for (const station of shift.stations) {
      data.push([
        textCell(
          /^\d+$/.test(station.station.trim())
            ? `Station ${station.station.trim()}`
            : station.station,
          {
            columnSpan: 8,
            fontWeight: 'bold',
            backgroundColor: '#CCD8E8',
            height: 24,
          },
        ),
      ]);
      for (const row of station.rows) {
        const values = [
          row.positionId,
          row.unit,
          row.position,
          row.rank,
          row.member ? `${row.memberRank ?? row.rank} ${row.member}` : '',
          row.aDay ?? '',
          row.status,
          [...row.markers, ...row.temporaryDuties.map((duty) => `Temporary duty: ${duty}`)].join(
            '; ',
          ),
        ];
        const widths = [12, 20, 27, 10, 30, 16, 16, 42];
        const height = Math.max(
          32,
          ...values.map(
            (value, index) =>
              (Math.ceil(value.length / (widths[index] ?? 12)) + value.split('\n').length - 1) *
                15 +
              8,
          ),
        );
        data.push(
          values.map((value) =>
            textCell(value, {
              wrap: true,
              alignVertical: 'top',
              height,
              backgroundColor: row.status === 'Selected' ? '#EDF8F1' : '#FFFFFF',
              bottomBorderColor: '#D7DEE8',
              bottomBorderStyle: 'thin',
            }),
          ),
        );
      }
    }
    if (shift.positions === 0)
      data.push([textCell('No seats in this saved shift.', { columnSpan: 8 })]);
    if (
      roster.unplacedTemporaryDuties.length &&
      shift === roster.shifts[roster.shifts.length - 1]
    ) {
      data.push([
        textCell('Temporary duties without a seat', { columnSpan: 8, fontWeight: 'bold' }),
      ]);
      for (const duty of roster.unplacedTemporaryDuties)
        data.push([textCell(duty, { columnSpan: 8, wrap: true })]);
    }
    return {
      sheet: shiftLabel(shift.shift),
      data,
      orientation: 'landscape' as const,
      stickyRowsCount: 6,
      showGridLines: false,
      columns: [12, 20, 27, 10, 30, 16, 16, 42].map((width) => ({ width })),
    };
  });
}

export async function generateShiftWorkbook(roster: ShiftRoster): Promise<Blob> {
  return (await writeXlsxFile(shiftWorkbookSheets(roster))).toBlob();
}
