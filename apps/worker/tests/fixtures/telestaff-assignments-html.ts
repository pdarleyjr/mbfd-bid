/**
 * Sanitized acceptance data for the future TeleStaff `(EX) Export
 * Assignments` HTML report. These source rows are synthetic only: no real
 * employee names or identifiers belong in the repository.
 */

export interface SyntheticTeleStaffAssignment {
  employeeId: string;
  name: string;
  shift: string;
  division: string;
  station: string;
  unit: string | null;
  position: string | null;
  aRDay: string | null;
}

export const FUTURE_HTML_SHIFT_COUNTS = {
  'A Shift': 67,
  'B Shift': 73,
  'C Shift': 70,
  'D Shift 4/10': 39,
  'D Shift 5/8': 13,
} as const;

export const ORIGINAL_SHIFT_COUNTS = {
  'A Shift': 68,
  'B Shift': 72,
  'C Shift': 70,
  'D Shift 4/10': 39,
  'D Shift 5/8': 13,
} as const;

export const FUTURE_A_R_DAY_COUNTS = {
  'A Shift': { 'Group 1': 16, 'Group 2': 17, 'Group 3': 18, 'Group 4': 16 },
  'B Shift': { 'Group 1': 18, 'Group 2': 19, 'Group 3': 18, 'Group 4': 18 },
  'C Shift': { 'Group 1': 19, 'Group 2': 17, 'Group 3': 17, 'Group 4': 17 },
} as const;

export const FUTURE_HTML_EXPECTATIONS = {
  totalRows: 262,
  structuralBlankRows: 1,
  uniqueEmployeeIds: 262,
  missingUnitRows: 9,
  missingPositionRows: 11,
  missingARDayRows: 4,
  shiftCounts: FUTURE_HTML_SHIFT_COUNTS,
  aRDayCounts: FUTURE_A_R_DAY_COUNTS,
} as const;

const MARINE_TOPOLOGY = [
  { unit: 'Fire Boat 6', position: 'Marine Captain' },
  { unit: 'Fire Boat 6', position: 'Marine Operator' },
  { unit: 'Fire Boat 6', position: 'Marine Engineer' },
  { unit: 'Fire Boat 6', position: 'Marine Deckhand' },
  { unit: 'Marine Float', position: 'Marine Floater' },
  { unit: 'Marine Float', position: 'Marine Floater' },
] as const;

const NON_MARINE_STATIONS = ['1', '2', '3', '4', '5', '7', '8', '9'] as const;

function syntheticEmployeeId(sequence: number): string {
  return `SYNTH-${String(sequence).padStart(6, '0')}`;
}

function buildGroupValues(counts: Readonly<Record<string, number>>): string[] {
  return Object.entries(counts).flatMap(([group, count]) =>
    Array.from({ length: count }, () => group),
  );
}

function buildAbcRows(
  shift: 'A Shift' | 'B Shift' | 'C Shift',
  groupCounts: Readonly<Record<string, number>>,
  nextSequence: () => number,
  includeDivisionChief = false,
): SyntheticTeleStaffAssignment[] {
  const groups = buildGroupValues(groupCounts);
  return groups.map((aRDay, index) => {
    const marine = MARINE_TOPOLOGY[index];
    // The source report confirms one Division Chief assignment per A/B/C
    // shift. This is only a sanitized source observation: it deliberately
    // does not carry or infer the MBFD-owned A211/B211/C211 slot identity.
    const divisionChief =
      includeDivisionChief && marine === undefined && index === MARINE_TOPOLOGY.length;
    const nonMarineStation = NON_MARINE_STATIONS[index % NON_MARINE_STATIONS.length] ?? '1';
    const sequence = nextSequence();
    return {
      employeeId: syntheticEmployeeId(sequence),
      name: `Synthetic Member ${String(sequence).padStart(3, '0')}`,
      shift,
      division: 'Suppression/Rescue',
      station: marine ? '6' : nonMarineStation,
      unit: marine?.unit ?? `Engine ${nonMarineStation}`,
      position: marine?.position ?? (divisionChief ? 'Division Chief' : 'Firefighter'),
      aRDay,
    };
  });
}

function buildD410Rows(nextSequence: () => number): SyntheticTeleStaffAssignment[] {
  const offDays = ['Mondays Off', 'Tuesday Off', 'Wednesday Off', 'Thursday Off', 'Friday Off'];
  return Array.from({ length: FUTURE_HTML_SHIFT_COUNTS['D Shift 4/10'] }, (_, index) => {
    const sequence = nextSequence();
    return {
      employeeId: syntheticEmployeeId(sequence),
      name: `Synthetic Member ${String(sequence).padStart(3, '0')}`,
      shift: 'D Shift 4/10',
      division: 'Administration',
      station: 'HQ',
      unit: index < FUTURE_HTML_EXPECTATIONS.missingUnitRows ? null : 'Support Unit',
      position: index < FUTURE_HTML_EXPECTATIONS.missingPositionRows ? null : 'Support Specialist',
      // The future fixture has four absent A/R-day cells in total; one is
      // intentionally represented on D 5/8 below.
      aRDay:
        index < FUTURE_HTML_EXPECTATIONS.missingARDayRows - 1
          ? null
          : (offDays[index % offDays.length] ?? null),
    };
  });
}

function buildD58Rows(nextSequence: () => number): SyntheticTeleStaffAssignment[] {
  return Array.from({ length: FUTURE_HTML_SHIFT_COUNTS['D Shift 5/8'] }, (_, index) => {
    const sequence = nextSequence();
    return {
      employeeId: syntheticEmployeeId(sequence),
      name: `Synthetic Member ${String(sequence).padStart(3, '0')}`,
      shift: 'D Shift 5/8',
      division: 'Administration',
      station: 'HQ',
      unit: 'Support Unit',
      position: 'Support Specialist',
      aRDay: index === 0 ? null : 'Saturday & Sunday Off',
    };
  });
}

function buildCompleteD410Rows(nextSequence: () => number): SyntheticTeleStaffAssignment[] {
  const offDays = ['Mondays Off', 'Tuesday Off', 'Wednesday Off', 'Thursday Off', 'Friday Off'];
  return Array.from({ length: ORIGINAL_SHIFT_COUNTS['D Shift 4/10'] }, (_, index) => {
    const sequence = nextSequence();
    return {
      employeeId: syntheticEmployeeId(sequence),
      name: `Synthetic Member ${String(sequence).padStart(3, '0')}`,
      shift: 'D Shift 4/10',
      division: 'Administration',
      station: 'HQ',
      unit: 'Support Unit',
      position: 'Support Specialist',
      aRDay: offDays[index % offDays.length] ?? null,
    };
  });
}

function buildCompleteD58Rows(nextSequence: () => number): SyntheticTeleStaffAssignment[] {
  return Array.from({ length: ORIGINAL_SHIFT_COUNTS['D Shift 5/8'] }, () => {
    const sequence = nextSequence();
    return {
      employeeId: syntheticEmployeeId(sequence),
      name: `Synthetic Member ${String(sequence).padStart(3, '0')}`,
      shift: 'D Shift 5/8',
      division: 'Administration',
      station: 'HQ',
      unit: 'Support Unit',
      position: 'Support Specialist',
      aRDay: 'Saturday & Sunday Off',
    };
  });
}

/**
 * Returns the synthetic assignment observations underlying the future-format
 * HTML fixture. This is fixture-only evidence; it is never Bid capacity data.
 */
export function buildFutureTeleStaffAssignments(): SyntheticTeleStaffAssignment[] {
  let sequence = 1;
  const nextSequence = () => sequence++;
  const rows = [
    ...buildAbcRows('A Shift', FUTURE_A_R_DAY_COUNTS['A Shift'], nextSequence, true),
    ...buildAbcRows('B Shift', FUTURE_A_R_DAY_COUNTS['B Shift'], nextSequence, true),
    ...buildAbcRows('C Shift', FUTURE_A_R_DAY_COUNTS['C Shift'], nextSequence, true),
    ...buildD410Rows(nextSequence),
    ...buildD58Rows(nextSequence),
  ];

  if (rows.length !== FUTURE_HTML_EXPECTATIONS.totalRows) {
    throw new Error('Future TeleStaff fixture count is not deterministic.');
  }
  return rows;
}

/**
 * A separate sanitized historical scenario. It intentionally keeps the
 * previously accepted 68/72/70 count contract rather than "correcting" it to
 * the future snapshot. It is not a retained raw source artifact.
 */
export function buildOriginalTeleStaffAssignments(): SyntheticTeleStaffAssignment[] {
  let sequence = 1_001;
  const nextSequence = () => sequence++;
  const groups = (count: number) => ({
    'Group 1': Math.floor(count / 4),
    'Group 2': Math.floor(count / 4),
    'Group 3': Math.floor(count / 4),
    'Group 4': count - Math.floor(count / 4) * 3,
  });
  const rows = [
    ...buildAbcRows('A Shift', groups(ORIGINAL_SHIFT_COUNTS['A Shift']), nextSequence),
    ...buildAbcRows('B Shift', groups(ORIGINAL_SHIFT_COUNTS['B Shift']), nextSequence),
    ...buildAbcRows('C Shift', groups(ORIGINAL_SHIFT_COUNTS['C Shift']), nextSequence),
    ...buildCompleteD410Rows(nextSequence),
    ...buildCompleteD58Rows(nextSequence),
  ];
  if (rows.length !== FUTURE_HTML_EXPECTATIONS.totalRows) {
    throw new Error('Original TeleStaff fixture count is not deterministic.');
  }
  return rows;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cell(
  value: string | null,
  placeholderStyle: 'hidden' | 'nbsp' | 'empty' = 'empty',
): string {
  if (value !== null) return `<td><span>${escapeHtml(value)}</span></td>`;
  if (placeholderStyle === 'hidden') {
    return '<td><div style="display: none">placeholder only</div>&nbsp;</td>';
  }
  if (placeholderStyle === 'nbsp') return '<td><span>\u00a0</span></td>';
  return '<td><span></span></td>';
}

function buildAssignmentsHtml(
  rows: readonly SyntheticTeleStaffAssignment[],
  includeStructuralBlank: boolean,
): string {
  let nullPlaceholderOrdinal = 0;
  const placeholderFor = (value: string | null): 'hidden' | 'nbsp' | 'empty' => {
    if (value !== null) return 'empty';
    const style =
      nullPlaceholderOrdinal === 0 ? 'hidden' : nullPlaceholderOrdinal === 1 ? 'nbsp' : 'empty';
    nullPlaceholderOrdinal += 1;
    return style;
  };
  const body = rows
    .map((row, index) => {
      return `<tr data-report-row="${index + 1}">\n${cell(row.name)}\n${cell(row.employeeId)}\n${cell(row.shift)}\n${cell(row.division)}\n${cell(row.station)}\n${cell(row.unit, placeholderFor(row.unit))}\n${cell(row.position, placeholderFor(row.position))}\n${cell(row.aRDay, placeholderFor(row.aRDay))}\n</tr>`;
    })
    .join('\n');

  const structuralBlank = `<tr id="__bookmark_ignored">\n${cell(null, 'hidden')}\n${cell(null, 'nbsp')}\n${cell(null)}\n${cell(null)}\n${cell(null)}\n${cell(null)}\n${cell(null)}\n${cell(null)}\n</tr>`;
  return `<!doctype html>
<html><body>
  <table id="AUTOGENBOOKMARK_ignored" class="style_18"><tr><td>Report header</td></tr></table>
  <table id="__bookmark_1" class="style_21" data-report="Export Assignments">
    <thead><tr>
      <th><div>Name</div></th><th><span>Emp&nbsp;ID</span></th><th>Shift</th><th>Division</th>
      <th>Station</th><th>Unit</th><th>Position</th><th>A/R Day</th>
    </tr></thead>
    <tbody>
${body}
 ${includeStructuralBlank ? structuralBlank : ''}
     </tbody>
   </table>
</body></html>`;
}

/** Builds a sanitized, semantic-layout `(EX) Export Assignments` test report. */
export function buildFutureTeleStaffAssignmentsHtml(): string {
  return buildAssignmentsHtml(buildFutureTeleStaffAssignments(), true);
}

/**
 * The earlier accepted count scenario remains its own source-format parser
 * case. It deliberately does not inherit the future report's counts.
 */
export function buildOriginalTeleStaffAssignmentsHtml(): string {
  return buildAssignmentsHtml(buildOriginalTeleStaffAssignments(), false);
}
