import {
  type ExportShift,
  type ShiftRoster,
  type ShiftRosterRow,
  shiftLabel,
} from './shift-roster.js';

export const SHIFT_VIEW_COLORS: Record<ExportShift, string> = {
  A: '#008C00',
  B: '#1649D8',
  C: '#C90000',
  D: '#5D3987',
};

export interface ShiftViewBlock {
  station: string;
  rows: ShiftRosterRow[];
  units: Array<{ unit: string; rows: ShiftRosterRow[] }>;
}

/** Keep the original station/unit grouping, then place its smaller float-pool
 * blocks beside the stations. No seat is omitted to make the sheet fit. */
export function shiftViewColumns(shift: ShiftRoster['shifts'][number]): ShiftViewBlock[][] {
  const blocks = shift.stations.map((station) => ({
    ...station,
    units: [...new Set(station.rows.map((row) => row.unit))].map((unit) => ({
      unit,
      rows: station.rows.filter((row) => row.unit === unit),
    })),
  }));
  const numbered = blocks.filter((block) => /^(?:Station\s*#?\s*)?\d+$/i.test(block.station));
  const other = blocks.filter((block) => !numbered.includes(block));
  const count = Math.min(6, Math.max(1, numbered.length + (other.length ? 1 : 0)));
  // Days often has named administrative divisions rather than numbered stations.
  if (!numbered.length) {
    const namedBlocks =
      shift.shift === 'D'
        ? blocks.flatMap((block) =>
            block.units.map((unit) => ({
              station: `${block.station} / ${unit.unit}`,
              rows: unit.rows,
              units: [unit],
            })),
          )
        : blocks;
    const columns: ShiftViewBlock[][] = Array.from(
      { length: Math.min(6, Math.max(1, namedBlocks.length)) },
      () => [],
    );
    for (const block of namedBlocks) {
      const target = columns.reduce((a, b) => (blockHeight(a) <= blockHeight(b) ? a : b));
      target.push(block);
    }
    return columns;
  }
  const columns: ShiftViewBlock[][] = Array.from({ length: count }, () => []);
  for (const [index, block] of numbered.entries()) columns[index % count]?.push(block);
  for (const block of other) {
    const station6 = numbered.findIndex((station) => /(?:#?\s*)6$/.test(station.station));
    // Marine float and Union President appear below Station 6 in the source board.
    const preferred =
      /Marine Float|Union President/i.test(block.station) && station6 >= 0
        ? columns[station6 % count]
        : /Float/i.test(block.station)
          ? columns[count - 1]
          : undefined;
    const target =
      preferred ?? columns.reduce((a, b) => (blockHeight(a) <= blockHeight(b) ? a : b));
    target?.push(block);
  }
  return columns;
}

function blockHeight(blocks: ShiftViewBlock[]): number {
  return blocks.reduce((height, block) => height + block.rows.length + 3, 0);
}

export function shiftViewStationLabel(station: string): string {
  return /^\d+$/.test(station.trim()) ? `Station #${station.trim()}` : station;
}

export function shiftViewTitle(shift: ShiftRoster['shifts'][number]): string {
  const chiefs = shift.stations
    .flatMap((station) => station.rows)
    .filter((row) => row.administrativeAssignment && row.rank === 'DC' && row.member);
  return `${shiftLabel(shift.shift)}${chiefs.length === 1 && chiefs[0]?.member ? ` (Chief ${chiefs[0].member.replace(/^Chief\s+/i, '')})` : ''}`;
}

export function shiftViewUnitColor(unit: string): string {
  if (/rescue float/i.test(unit)) return '#A8C7E7';
  if (/rescue/i.test(unit)) return '#BADADD';
  if (/float|marine|boat/i.test(unit)) return '#F4C194';
  if (/combat|ladder/i.test(unit)) return '#D4A1A1';
  if (/engine/i.test(unit)) return '#BBB0D0';
  if (/chief|300|captain 5/i.test(unit)) return '#BCD2E9';
  return '#CBD7E7';
}

export function shiftViewADay(value: string | null): string {
  if (value === 'Deferred') return 'Due';
  return value?.replace(/^Group (\d+)$/, 'GR$1') ?? '';
}

export function shiftViewOccupant(row: ShiftRosterRow): string {
  const parts = row.member ? [row.member] : [];
  parts.push(...row.markers.map((marker) => `[${marker}]`));
  parts.push(...row.temporaryDuties.map((duty) => `Temporary: ${duty}`));
  if (!parts.length && row.status === 'Not biddable') parts.push('Admin assigned');
  return parts.join('\n');
}

export function shiftViewOccupied(row: ShiftRosterRow): boolean {
  return row.member !== null || row.temporaryDuties.length > 0;
}

/** Counts describe the seats actually occupied in this export. Unknown older
 * topology metadata stays unknown rather than being inferred from labels. */
export function shiftViewSummaries(shift: ShiftRoster['shifts'][number]) {
  const rows = shift.stations.flatMap((station) => station.rows);
  const occupied = rows.filter((row) => shiftViewOccupied(row) && !row.isExcludedFromCount);
  const divisionKnown = rows.every((row) => row.division !== undefined);
  const floatingKnown = rows.every((row) => row.isFloating !== undefined);
  return [
    {
      label: 'SHIFT',
      values: [
        ['Current shift count', occupied.length],
        ['Bid capacity', shift.selected + shift.available],
        ['Current total bid', shift.selected],
        ['Open bid seats', shift.available],
      ] as Array<[string, number | string]>,
    },
    {
      label: 'RANK',
      values: [
        ['Division Chief', occupied.filter((row) => row.rank === 'DC').length],
        ['Captain', occupied.filter((row) => row.rank === 'CPT').length],
        ['Lieutenant', occupied.filter((row) => row.rank === 'LT').length],
        ['Firefighter', occupied.filter((row) => row.rank === 'FF').length],
        ['Total shift', occupied.length],
      ] as Array<[string, number | string]>,
    },
    {
      label: 'DIVISION',
      values: divisionKnown
        ? ([
            ['Combat', occupied.filter((row) => row.division === 'Combat').length],
            ['Rescue', occupied.filter((row) => row.division === 'Rescue').length],
            [
              'Other',
              occupied.filter((row) => !['Combat', 'Rescue'].includes(row.division ?? '')).length,
            ],
            ['Total shift', occupied.length],
          ] as Array<[string, number | string]>)
        : ([['Saved division detail', 'Unavailable']] as Array<[string, number | string]>),
    },
    {
      label: 'ASSIGNED / FLOAT',
      values: floatingKnown
        ? ([
            ['Assigned', occupied.filter((row) => !row.isFloating).length],
            ['Float', occupied.filter((row) => row.isFloating).length],
            ['Total shift', occupied.length],
          ] as Array<[string, number | string]>)
        : ([['Saved float detail', 'Unavailable']] as Array<[string, number | string]>),
    },
    {
      label: 'SPECIALTY SEATS',
      values: [
        ['Captain 5', occupied.filter((row) => /Captain 5/i.test(row.position + row.unit)).length],
        [
          'Driver engineer',
          occupied.filter((row) => /Firefighter DE|Driver Engineer/i.test(row.position)).length,
        ],
        [
          'Air Tech 810',
          occupied.filter((row) =>
            /Air\s*Tech|\b810\b|#\s*1\s*AT\b/i.test(`${row.position} ${row.unit}`),
          ).length,
        ],
        [
          'Investigator',
          occupied.filter((row) => /Investigat|#\s*1\s*INV\b/i.test(`${row.position} ${row.unit}`))
            .length,
        ],
        ['Marine', occupied.filter((row) => /marine|boat/i.test(row.position + row.unit)).length],
      ] as Array<[string, number | string]>,
    },
  ];
}
