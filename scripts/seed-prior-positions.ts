#!/usr/bin/env tsx
/**
 * One-shot seeder for `members.prior_position_id`.
 *
 * Reads the 2025 bid_pick.csv export (kept under MBFD_Hub/analysis/ to
 * preserve the source-of-truth chain of custody) and emits SQL UPDATE
 * statements that backfill each member's prior-year assignment.
 *
 * Usage (PowerShell):
 *   pnpm tsx scripts/seed-prior-positions.ts \
 *     "D:/GitHub_Repos/MBFD_Hub/analysis/bid_pick.csv" \
 *     > prior-positions.sql
 *
 *   pnpm wrangler d1 execute mbfd-bid-staging --remote --file=prior-positions.sql
 *
 * Idempotent: the UPDATE matches on employee_id, so re-running with the
 * same CSV is a no-op. Members not present in the CSV (new hires) keep
 * their NULL prior_position_id.
 */
import { readFileSync } from 'node:fs';

interface Row {
  employeeId: string;
  positionId: string;
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0] as string);
  const empIdx = header.indexOf('Emp Id');
  const posIdx = header.indexOf('Position #');
  if (empIdx < 0 || posIdx < 0) {
    throw new Error(`bid_pick.csv missing required columns. Found header: ${header.join(', ')}`);
  }
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i] as string);
    const employeeId = (cols[empIdx] ?? '').trim();
    const positionId = (cols[posIdx] ?? '').trim();
    if (employeeId.length === 0 || positionId.length === 0) continue;
    // Skip CSV rows that are clearly footers / summary lines.
    if (!/^\d+$/.test(employeeId)) continue;
    rows.push({ employeeId, positionId });
  }
  return rows;
}

/**
 * Minimal CSV line parser: handles quoted strings with embedded commas.
 * The legacy bid_pick.csv has commas inside quoted "Last, First" names.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

function main(): void {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: tsx scripts/seed-prior-positions.ts <path-to-bid_pick.csv>');
    process.exit(1);
  }
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  process.stdout.write('-- Prior-position backfill from 2025 bid_pick.csv\n');
  process.stdout.write(`-- Source: ${csvPath}\n`);
  process.stdout.write(`-- Row count: ${rows.length}\n\n`);
  for (const r of rows) {
    process.stdout.write(
      `UPDATE members SET prior_position_id = '${escapeSql(r.positionId)}' WHERE employee_id = '${escapeSql(r.employeeId)}';\n`,
    );
  }
}

main();
