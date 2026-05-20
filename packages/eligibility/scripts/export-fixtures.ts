/**
 * One-time fixture export script.
 *
 *   Run:   npx tsx packages/eligibility/scripts/export-fixtures.ts
 *   Env:   ANALYSIS_DIR can override the source CSV directory.
 *
 * Reads source CSV files from the sibling MBFD_Hub repo and writes JSON fixtures
 * for the eligibility engine's golden replay test. Not part of build or CI.
 *
 * The generated fixtures contain real personnel data and are .gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANALYSIS_DIR =
  process.env.ANALYSIS_DIR ?? path.resolve(__dirname, '../../../../MBFD_Hub/analysis');
const FIXTURE_DIR = path.resolve(__dirname, '../tests/fixtures');

if (!fs.existsSync(ANALYSIS_DIR)) {
  console.error(`ANALYSIS_DIR not found: ${ANALYSIS_DIR}`);
  console.error('Set ANALYSIS_DIR env to the directory containing personnel.csv / bid_pick.csv');
  process.exit(1);
}
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

const RANK_MAP: Record<string, string> = {
  firefighter: 'FF',
  lieutenant: 'LT',
  captain: 'CPT',
  'division chief': 'DC',
  'deputy fire chief': 'DEP_CHIEF',
  'fire chief': 'CHIEF',
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else if (ch === '"') {
      inQuotes = true;
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(raw: string): { cols: string[]; rows: string[][] } {
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0];
  if (header === undefined) {
    return { cols: [], rows: [] };
  }
  const cols = parseCsvLine(header).map((c) => c.toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map((row) => parseCsvLine(row));
  return { cols, rows };
}

function rowToObject(cols: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  cols.forEach((col, i) => {
    obj[col] = row[i] ?? '';
  });
  return obj;
}

const personnelRaw = fs.readFileSync(path.join(ANALYSIS_DIR, 'personnel.csv'), 'utf8');
const personnel = parseCsv(personnelRaw);

const members = personnel.rows
  .map((row) => {
    const obj = rowToObject(personnel.cols, row);
    const currentRank = (obj.current_rank ?? '').toLowerCase();
    const rank = RANK_MAP[currentRank];
    if (rank === undefined) {
      return null;
    }
    if (obj.bid === 'Exclude') {
      return null;
    }
    const rscSeniorityRaw = obj.rsc_seniority ?? obj.rscseniorityin ?? '';
    const rscSeniority = rscSeniorityRaw.length > 0 ? Number(rscSeniorityRaw) : 9999;
    const rankSeniorityRaw = obj.rank_seniority ?? '';
    const rankSeniority = rankSeniorityRaw.length > 0 ? Number(rankSeniorityRaw) : undefined;
    return {
      employeeId: obj.employee_id ?? '',
      firstName: obj.first_name ?? '',
      lastName: obj.last_name ?? '',
      rank,
      rscSeniority,
      rankSeniority,
      isProbationary: (obj.is_probationary ?? '').toLowerCase() === 'true',
      credentials: [] as { name: string }[],
    };
  })
  .filter((m): m is NonNullable<typeof m> => m !== null);

fs.writeFileSync(
  path.join(FIXTURE_DIR, '2025-members.json'),
  `${JSON.stringify(members, null, 2)}\n`,
);
// biome-ignore lint/suspicious/noConsole: offline build script
console.log(
  `Wrote ${members.length} members → ${path.relative(process.cwd(), FIXTURE_DIR)}/2025-members.json`,
);

const bidRaw = fs.readFileSync(path.join(ANALYSIS_DIR, 'bid_pick.csv'), 'utf8');
const bid = parseCsv(bidRaw);
const bidColsNormalized = bid.cols.map((c) => c.replace(/[#]+/g, '_').replace(/-/g, '_'));

const picks = bid.rows
  .map((row) => {
    const obj: Record<string, string> = {};
    bidColsNormalized.forEach((col, i) => {
      obj[col] = row[i] ?? '';
    });
    const empId = obj.emp_id ?? '';
    if (empId.length === 0) {
      return null;
    }
    const bidNumberRaw = obj.bid__ ?? obj.bid_ ?? '';
    const rankRaw = (obj.current_rank ?? '').toLowerCase();
    return {
      bidNumber: bidNumberRaw.length > 0 ? Number(bidNumberRaw) : 0,
      employeeId: empId,
      positionId: obj.position__ ?? obj.position_ ?? '',
      aDayPositionId: obj.r_day_pick ?? obj.a_day_pick ?? '',
      lastName: obj.last_name ?? '',
      firstName: obj.first_name ?? '',
      rank: RANK_MAP[rankRaw] ?? obj.current_rank ?? '',
      bidCategory: obj.bid_category ?? '',
    };
  })
  .filter((p): p is NonNullable<typeof p> => p !== null);

fs.writeFileSync(
  path.join(FIXTURE_DIR, '2025-actual-bid.json'),
  `${JSON.stringify(picks, null, 2)}\n`,
);
// biome-ignore lint/suspicious/noConsole: offline build script
console.log(
  `Wrote ${picks.length} bid picks → ${path.relative(process.cwd(), FIXTURE_DIR)}/2025-actual-bid.json`,
);

const rulesSource = path.resolve(__dirname, '../../../apps/worker/seed/fixtures/2026_rules.json');
const rulesTarget = path.join(FIXTURE_DIR, '2025-rules.json');
if (fs.existsSync(rulesSource)) {
  fs.copyFileSync(rulesSource, rulesTarget);
  // biome-ignore lint/suspicious/noConsole: offline build script
  console.log(`Copied 2026_rules.json → ${path.relative(process.cwd(), rulesTarget)}`);
} else {
  console.warn(`Source rules not found: ${rulesSource} — golden replay will skip`);
}
