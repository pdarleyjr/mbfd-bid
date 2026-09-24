import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheet } from 'read-excel-file/node';

const EXPECTED_SHA256 = '0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a';
const CLOSED_2026_OPPORTUNITIES = new Set(['A801', 'D201', 'D301', 'D401', 'D402']);
const COMBAT_CORRECTIONS = new Set(['B214', 'C214']);

const sourcePath = process.argv[2];
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(workerRoot, 'seed/fixtures/final_2026_positions.json');
if (!sourcePath)
  throw new Error(
    'usage: node scripts/extract-final-2026-positions.mjs <MASTER.xlsx> [output.json]',
  );

const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== EXPECTED_SHA256)
  throw new Error(`final_2026_master_sha256_mismatch:${sourceSha256}`);

const rows = await readSheet(sourcePath, 'Positions');
const expectedHeaders = [
  'Number',
  'Shift',
  'Station',
  'Division',
  'Unit',
  'Rank',
  'Position',
  'Assignment',
  'Enabled',
];
if (JSON.stringify(rows[0]) !== JSON.stringify(expectedHeaders))
  throw new Error('final_2026_positions_headers_invalid');

function bidRank(value) {
  if (value === 'Division Chief') return 'DC';
  if (value.startsWith('Captain')) return 'CPT';
  if (value.startsWith('Lieutenant')) return 'LT';
  if (value.startsWith('Firefighter')) return 'FF';
  throw new Error(`final_2026_position_rank_invalid:${value}`);
}

const positions = rows.slice(1).map((row) => {
  const [
    id,
    shiftLabel,
    station,
    sourceDivision,
    unit,
    positionName,
    sourceOrdinal,
    assignment,
    enabled,
  ] = row;
  if (typeof id !== 'string' || typeof shiftLabel !== 'string' || typeof positionName !== 'string')
    throw new Error('final_2026_position_row_invalid');
  if (enabled !== 'Yes') throw new Error(`final_2026_position_not_enabled:${id}`);
  const shift = shiftLabel.slice(0, 1);
  if (!['A', 'B', 'C', 'D'].includes(shift)) throw new Error(`final_2026_shift_invalid:${id}`);
  const correctedDivision = COMBAT_CORRECTIONS.has(id) ? 'Combat' : sourceDivision;
  return {
    id,
    shift,
    station,
    division: correctedDivision,
    unit,
    rankRequired: bidRank(positionName),
    positionName,
    isFloating: assignment === 'Floating',
    isVacantByDesign: false,
    isExcludedFromCount: CLOSED_2026_OPPORTUNITIES.has(id),
    source: {
      workbookSha256: sourceSha256,
      sheet: 'Positions',
      row: rows.indexOf(row) + 1,
      sourceDivision,
      sourceOrdinal,
      correction:
        correctedDivision === sourceDivision
          ? null
          : '2026-09-24 administrative decision: runtime Division is Combat; raw MASTER label retained',
    },
  };
});

const counts = positions.reduce((result, position) => {
  result[position.shift] = (result[position.shift] ?? 0) + 1;
  return result;
}, {});
if (
  positions.length !== 228 ||
  new Set(positions.map((position) => position.id)).size !== 228 ||
  JSON.stringify(counts) !== JSON.stringify({ A: 74, B: 73, C: 73, D: 8 }) ||
  positions.filter((position) => !position.isExcludedFromCount).length !== 223
)
  throw new Error(
    `final_2026_position_shape_invalid:${positions.length}:${JSON.stringify(counts)}`,
  );

await writeFile(outputPath, `${JSON.stringify(positions, null, 2)}\n`, 'utf8');
// biome-ignore lint/suspicious/noConsole: deterministic CLI extraction receipt
console.log(
  JSON.stringify({ outputPath, sourceSha256, topology: positions.length, active: 223, counts }),
);
