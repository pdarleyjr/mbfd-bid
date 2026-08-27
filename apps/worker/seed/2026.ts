/**
 * 2026 seed script.
 *
 * Usage:
 *   pnpm --filter @mbfd/worker db:seed:local   # --> tsx seed/2026.ts --local
 *   pnpm --filter @mbfd/worker db:seed:remote  # --> tsx seed/2026.ts --remote
 *
 * Idempotency:
 *   - position_templates / rule_books: INSERT OR IGNORE
 *   - positions / credentials:          UPSERT / INSERT OR IGNORE
 *   - position_rules:                   DELETE + INSERT per (positionId, templateVersion, ruleBookVersion)
 *   - audit_log marker:                 one deterministic INSERT OR IGNORE marker
 *
 * Remote execution: writes SQL to a temp file and delegates to wrangler.
 * Local execution:  same approach (wrangler --local flag).
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const SEED_2026_AUDIT_ID = '01JGFJJZ000000000000000000';

// ---------------------------------------------------------------------------
// Types (local mirrors of shared schemas to avoid ESM import friction in seed)
// ---------------------------------------------------------------------------

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

interface CredentialRecord {
  name: string;
  fyPointsDefault: number;
  abbreviation: string | null;
  notes: string | null;
}

interface RuleEntry {
  positionId: string;
  templateVersion: string;
  ruleBookVersion: string;
  requiredCriteria: { rank: string[]; credentials: string[]; custom: string[] };
  pointsPreference: { max: number; items: unknown[] };
  tieBreakChain: string[];
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function sqlStr(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlBool(value: boolean): string {
  return value ? '1' : '0';
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadPositions(): PositionRecord[] {
  const raw = readFileSync(join(FIXTURES_DIR, '2026_positions.json'), 'utf-8');
  return JSON.parse(raw) as PositionRecord[];
}

function loadCredentials(): CredentialRecord[] {
  const raw = readFileSync(join(FIXTURES_DIR, 'reference_credentials.json'), 'utf-8');
  return JSON.parse(raw) as CredentialRecord[];
}

function loadRules(): RuleEntry[] {
  const raw = readFileSync(join(FIXTURES_DIR, '2026_rules.json'), 'utf-8');
  return (JSON.parse(raw) as RuleEntry[]).filter(
    (r) => typeof r.positionId === 'string' && r.positionId.length > 0,
  );
}

// ---------------------------------------------------------------------------
// Default rule factory — for positions not in 2026_rules.json
// ---------------------------------------------------------------------------

function makeDefaultRule(pos: PositionRecord): RuleEntry {
  // Rescue positions require Paramedic credential
  const isRescue = pos.division === 'Rescue' || pos.unit.toLowerCase().includes('rescue');
  const credentials =
    isRescue && pos.rankRequired !== 'LT' && pos.rankRequired !== 'CPT' ? ['Paramedic'] : [];

  return {
    positionId: pos.id,
    templateVersion: '2026.1',
    ruleBookVersion: '2026.1',
    requiredCriteria: {
      rank: [pos.rankRequired],
      credentials,
      custom: [],
    },
    pointsPreference: { max: 0, items: [] },
    tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
    notes: 'Auto-generated placeholder — admin review required',
  };
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

function buildSql(
  positions: PositionRecord[],
  credentials: CredentialRecord[],
  explicitRules: RuleEntry[],
): string {
  const lines: string[] = [];

  // 1. position_templates
  lines.push('-- position_templates');
  lines.push(
    `INSERT OR IGNORE INTO position_templates (version, effective_year, notes) VALUES ('2026.1', 2026, NULL);`,
  );
  lines.push('');

  // 2. rule_books
  lines.push('-- rule_books');
  lines.push(
    `INSERT OR IGNORE INTO rule_books (version, effective_year, notes) VALUES ('2026.1', 2026, NULL);`,
  );
  lines.push('');

  // 3. positions
  lines.push('-- positions');
  for (const p of positions) {
    const id = sqlStr(p.id);
    const shift = sqlStr(p.shift);
    const station = sqlStr(p.station);
    const division = sqlStr(p.division);
    const unit = sqlStr(p.unit);
    const rankRequired = sqlStr(p.rankRequired);
    const positionName = sqlStr(p.positionName);
    const isFloating = sqlBool(p.isFloating);
    const isVacantByDesign = sqlBool(p.isVacantByDesign);
    const isExcludedFromCount = sqlBool(p.isExcludedFromCount);
    lines.push(
      `INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name, is_floating, is_vacant_by_design, is_excluded_from_count) VALUES (${id}, '2026.1', ${shift}, ${station}, ${division}, ${unit}, ${rankRequired}, ${positionName}, ${isFloating}, ${isVacantByDesign}, ${isExcludedFromCount}) ON CONFLICT(id, template_version) DO UPDATE SET shift = excluded.shift, station = excluded.station, division = excluded.division, unit = excluded.unit, rank_required = excluded.rank_required, position_name = excluded.position_name, is_floating = excluded.is_floating, is_vacant_by_design = excluded.is_vacant_by_design, is_excluded_from_count = excluded.is_excluded_from_count;`,
    );
  }
  lines.push('');

  // 4. credentials
  lines.push('-- credentials');
  for (const c of credentials) {
    const name = sqlStr(c.name);
    const pts = c.fyPointsDefault;
    lines.push(
      `INSERT OR IGNORE INTO credentials (name, fy_points_default) VALUES (${name}, ${pts});`,
    );
  }
  lines.push('');

  // 5. position_rules — build full set (explicit + defaults for missing)
  lines.push('-- position_rules');
  const explicitByPositionId = new Map<string, RuleEntry>(
    explicitRules.map((r) => [r.positionId, r]),
  );

  // Delete existing rules for this template+rulebook version first (idempotent replace)
  lines.push(
    `DELETE FROM position_rules WHERE template_version = '2026.1' AND rule_book_version = '2026.1';`,
  );

  let ruleCount = 0;
  for (const pos of positions) {
    // A701 Union President — excluded from count, no rule needed
    if (pos.id === 'A701') continue;

    const rule = explicitByPositionId.get(pos.id) ?? makeDefaultRule(pos);
    const positionId = sqlStr(pos.id);
    const reqJson = sqlStr(JSON.stringify(rule.requiredCriteria));
    const ptsJson = sqlStr(JSON.stringify(rule.pointsPreference));
    const tieJson = sqlStr(JSON.stringify(rule.tieBreakChain));
    const notes = sqlStr(rule.notes ?? null);
    lines.push(
      `INSERT INTO position_rules (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain, notes) VALUES ('2026.1', ${positionId}, '2026.1', ${reqJson}, ${ptsJson}, ${tieJson}, ${notes});`,
    );
    ruleCount += 1;
  }
  lines.push('');

  // 6. audit_log seed marker
  const now = Math.floor(Date.now() / 1000);
  const afterState = sqlStr(
    JSON.stringify({
      positions: positions.length,
      credentials: credentials.length,
      rules: ruleCount,
    }),
  );
  lines.push('-- audit_log seed marker');
  lines.push(
    `INSERT OR IGNORE INTO audit_log (id, bid_session_id, seq, actor_type, actor_id, action, target_kind, target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at) VALUES (${sqlStr(SEED_2026_AUDIT_ID)}, NULL, 0, 'system', NULL, 'session_start', 'seed', '2026', NULL, ${afterState}, 'Seed run 2026.ts', NULL, NULL, ${now});`,
  );
  lines.push('');

  return lines.join('\n');
}

export function buildSeedSqlFromFixtures(): string {
  return buildSql(loadPositions(), loadCredentials(), loadRules());
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function executeLocal(sqlFile: string): void {
  execSync(
    `pnpm exec wrangler d1 execute mbfd-bid-staging --env staging --local --file "${sqlFile}"`,
    { stdio: 'inherit', cwd: resolve(__dirname, '..') },
  );
}

function executeRemote(sqlFile: string): void {
  execSync(
    `pnpm exec wrangler d1 execute mbfd-bid-staging --env staging --remote --file "${sqlFile}"`,
    { stdio: 'inherit', cwd: resolve(__dirname, '..') },
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const isRemote = process.argv.includes('--remote');
  const isLocal = process.argv.includes('--local');

  if (!isRemote && !isLocal) {
    console.error('Usage: tsx seed/2026.ts [--local | --remote]');
    process.exit(1);
  }

  console.info('Loading fixtures...');
  const positions = loadPositions();
  const credentials = loadCredentials();
  const explicitRules = loadRules();

  console.info(
    `  Positions: ${positions.length}, Credentials: ${credentials.length}, Explicit rules: ${explicitRules.length}`,
  );

  console.info('Building SQL...');
  const sql = buildSql(positions, credentials, explicitRules);

  // Write SQL to a unique private temp dir. `mkdtempSync` creates a directory
  // with a random suffix and 0o700 permissions, avoiding the predictable-path
  // hazard CodeQL flags on `path.join(os.tmpdir(), ...)` (js/insecure-temporary-file).
  const tmpDirRoot = mkdtempSync(join(tmpdir(), 'mbfd-seed-2026-'));
  const sqlFile = join(tmpDirRoot, 'seed.sql');
  writeFileSync(sqlFile, sql, { encoding: 'utf-8', mode: 0o600 });
  console.info(`  Wrote SQL to ${sqlFile}`);

  try {
    console.info(`Executing against ${isRemote ? 'remote staging' : 'local'} D1...`);
    if (isRemote) {
      executeRemote(sqlFile);
    } else {
      executeLocal(sqlFile);
    }
  } finally {
    rmSync(tmpDirRoot, { recursive: true, force: true });
  }

  // Count rules (excludes A701)
  const ruleCount = positions.filter((p) => p.id !== 'A701').length;
  console.info(
    `Seeded: 1 position_template, 1 rule_book, ${positions.length} positions, ${credentials.length} credentials, ${ruleCount} rules.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
