/**
 * Developer one-off script — generates the three 2026 fixture files under
 * seed/fixtures/.  Run from the workspace root:
 *
 *   pnpm --filter @mbfd/worker exec tsx seed/_generate_fixtures.ts
 *
 * Requires the 2025 source files to exist outside the repo:
 *   D:/GitHub_Repos/MBFD_Hub/analysis/positions.csv
 *   D:/MBFD/Bid/2025 Bid Documents/eligible/2025 Bid position requirements and points.xlsx
 *
 * Output files (committed):
 *   seed/fixtures/2026_positions.json
 *   seed/fixtures/reference_credentials.json
 *   (2026_rules.json is hand-curated — this script skips it)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CredentialImportRow } from '@mbfd/shared';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// 2026 canonical Station 6 crew positions per shift
// ---------------------------------------------------------------------------
const MARINE_STATION = 'Station #6';
const MARINE_UNIT = 'Fire Boat';

function makeMarineRow(
  shift: 'A' | 'B' | 'C',
  slot: '1' | '2' | '3',
  positionName: string,
  rankRequired: 'FF' | 'LT' | 'CPT' | 'DC',
) {
  const id = `${shift}61${slot}`;
  return {
    id,
    shift,
    station: MARINE_STATION,
    division: 'Combat',
    unit: MARINE_UNIT,
    rankRequired,
    positionName,
    isFloating: false,
    isVacantByDesign: false,
    isExcludedFromCount: false,
  };
}

const STATION6_ROWS = (['A', 'B', 'C'] as const).flatMap((shift) => [
  makeMarineRow(shift, '1', 'Firefighter FBO', 'FF'),
  makeMarineRow(shift, '2', 'Marine Firefighter', 'FF'),
  makeMarineRow(shift, '3', 'Post St.6', 'FF'),
]);

// ---------------------------------------------------------------------------
// CSV → position rows
// ---------------------------------------------------------------------------

type CsvRow = {
  Number: string;
  Shift: string;
  Station: string;
  Division: string;
  Unit: string;
  Rank: string;
  Position: string;
  Assignment: string;
  Enabled: string;
};

const SHIFT_MAP: Record<string, 'A' | 'B' | 'C' | 'D'> = {
  'a shift': 'A',
  'b shift': 'B',
  'c shift': 'C',
  'd shift': 'D',
  days: 'D',
};

const RANK_MAP: Record<string, 'FF' | 'LT' | 'CPT' | 'DC'> = {
  firefighter: 'FF',
  'firefighter de': 'FF',
  'firefighter de (c)': 'FF',
  'firefighter #1': 'FF',
  'firefighter #1 (c)': 'FF',
  'firefighter #1 at': 'FF',
  'firefighter #1 inv': 'FF',
  'firefighter #2': 'FF',
  'firefighter #2 (c)': 'FF',
  'firefighter #3': 'FF',
  'firefighter #3 (c)': 'FF',
  'firefighter #4': 'FF',
  'firefighter #4 (c)': 'FF',
  'firefighter #5': 'FF',
  'firefighter #5 (c)': 'FF',
  'firefighter #6': 'FF',
  'firefighter #6(c)': 'FF',
  'firefighter #6 (c)': 'FF',
  'firefighter fbo': 'FF',
  'marine deckhand': 'FF',
  'marine firefighter #1': 'FF',
  'marine firefighter #2': 'FF',
  'post st.6': 'FF',
  lieutenant: 'LT',
  'lieutenant (r)': 'LT',
  'lieutenant #1 (r)': 'LT',
  'lieutenant #2 (r)': 'LT',
  captain: 'CPT',
  'captain #1 (c)': 'CPT',
  'captain 5': 'CPT',
  'division chief': 'DC',
};

function parseShift(raw: string): 'A' | 'B' | 'C' | 'D' | null {
  const k = raw.trim().toLowerCase();
  return SHIFT_MAP[k] ?? null;
}

function parseRank(raw: string): 'FF' | 'LT' | 'CPT' | 'DC' | null {
  const k = raw.trim().toLowerCase();
  // Exact match first
  if (RANK_MAP[k]) return RANK_MAP[k];
  // Prefix match for firefighter variants
  if (k.startsWith('firefighter')) return 'FF';
  if (k.startsWith('lieutenant')) return 'LT';
  if (k.startsWith('captain')) return 'CPT';
  if (k.startsWith('division chief')) return 'DC';
  return null;
}

function normaliseStation(raw: string): string {
  return raw.trim();
}

interface PositionRecord {
  id: string;
  shift: 'A' | 'B' | 'C' | 'D';
  station: string;
  division: string;
  unit: string;
  rankRequired: 'FF' | 'LT' | 'CPT' | 'DC';
  positionName: string;
  isFloating: boolean;
  isVacantByDesign: boolean;
  isExcludedFromCount: boolean;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split('\n').filter((l) => l.trim());
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h.trim()] = (cells[i] ?? '').trim();
    });
    return obj as unknown as CsvRow;
  });
}

async function generatePositions(): Promise<void> {
  const csvPath = 'D:/GitHub_Repos/MBFD_Hub/analysis/positions.csv';
  const raw = await readFile(csvPath, 'utf-8');
  const csvRows = parseCsv(raw);

  const positions: PositionRecord[] = [];
  const skipped: string[] = [];

  for (const row of csvRows) {
    const id = row.Number.trim();
    const stationRaw = row.Station.trim();

    // Drop Station #5 rows (and any that accidentally map to station 5)
    if (stationRaw === 'Station #5') {
      skipped.push(id);
      continue;
    }

    // Drop old Station #4 marine positions (XX411, XX412, XX413)
    if (/^[ABC]41[123]$/.test(id)) {
      skipped.push(id);
      continue;
    }

    // The 2025 CSV has no XX6xx rows except Rescue Float Pool (A601-A606, etc.)
    // which should be kept. New Station 6 rows (XX611-XX613) are added below.

    // Replace Station #4 marine positions on Engine 4 with general-pop names
    let finalPositionName = row.Rank.trim();
    if (id.match(/^[ABC]403$/)) finalPositionName = 'Firefighter #1';
    if (id.match(/^[ABC]404$/)) finalPositionName = 'Firefighter #2';

    const shift = parseShift(row.Shift);
    if (!shift) {
      console.warn(`  Skipping ${id}: unrecognised shift "${row.Shift}"`);
      skipped.push(id);
      continue;
    }

    const rankRequired = parseRank(row.Rank);
    if (!rankRequired) {
      console.warn(`  Skipping ${id}: unrecognised rank "${row.Rank}"`);
      skipped.push(id);
      continue;
    }

    const station = normaliseStation(stationRaw);
    const divisionRaw = row.Division.trim();

    // Normalise division to the allowed enum values
    const divisionMap: Record<string, string> = {
      Combat: 'Combat',
      Rescue: 'Rescue',
      Prevention: 'Prevention',
      Training: 'Training',
      'Support Services': 'Support Services',
      'Rescue Float Pool': 'Rescue',
      'Union President': 'Combat',
      Days: 'Prevention',
    };
    const division = divisionMap[divisionRaw] ?? divisionRaw;

    const assignmentRaw = (row.Assignment ?? '').trim().toLowerCase();
    const isFloating = assignmentRaw === 'floating';

    // Union President seat (A701) excluded from count
    const isExcludedFromCount = id === 'A701';

    // XX215 is vacant by design (Lt #2 R Float 2)
    const isVacantByDesign = /^[ABC]215$/.test(id);

    positions.push({
      id,
      shift,
      station,
      division,
      unit: row.Unit.trim(),
      rankRequired,
      positionName: finalPositionName,
      isFloating,
      isVacantByDesign,
      isExcludedFromCount,
    });
  }

  // Append 2026 Station 6 rows
  for (const r of STATION6_ROWS) {
    positions.push(r);
  }

  // Sort by id
  positions.sort((a, b) => a.id.localeCompare(b.id));

  console.info(`  Generated ${positions.length} positions (skipped ${skipped.length}).`);
  console.info(`  Skipped: ${skipped.join(', ')}`);

  await writeFile(
    resolve(FIXTURES_DIR, '2026_positions.json'),
    `${JSON.stringify(positions, null, 2)}\n`,
  );
  console.info('  Wrote seed/fixtures/2026_positions.json');
}

// ---------------------------------------------------------------------------
// Credentials from the "Credentials" sheet of the 2025 XLSX
// The sheet has columns: FY25 Cert #, FY25 Certifications, FY25 Points
// This is a normalized list (not a wide-matrix), so we parse it directly.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

async function generateCredentials(): Promise<void> {
  const xlsxPath =
    'D:/MBFD/Bid/2025 Bid Documents/eligible/2025 Bid position requirements and points.xlsx';
  const buf = await readFile(xlsxPath);
  const wb = XLSX.read(buf, { type: 'buffer' });

  const sheet = wb.Sheets.Credentials;
  if (!sheet) {
    throw new Error('No "Credentials" sheet found in XLSX');
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const enriched: CredentialImportRow[] = [];

  for (const row of rows) {
    const name = String(row['FY25 Certifications'] ?? '').trim();
    if (!name) continue;
    const rawPts = row['FY25 Points'];
    const fyPointsDefault =
      typeof rawPts === 'number' ? rawPts : Number(String(rawPts ?? '0')) || 0;
    enriched.push({
      name,
      fyPointsDefault,
      abbreviation: null,
      notes: null,
    });
  }

  console.info(`  Extracted ${enriched.length} credentials from XLSX.`);
  await writeFile(
    resolve(FIXTURES_DIR, 'reference_credentials.json'),
    `${JSON.stringify(enriched, null, 2)}\n`,
  );
  console.info('  Wrote seed/fixtures/reference_credentials.json');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.info('Generating 2026 fixture files...');
  await generatePositions();
  await generateCredentials();
  console.info('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
