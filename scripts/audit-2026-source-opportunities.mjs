import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source-only audit. It never saves a rule book or changes an existing Bid.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => resolve(root, 'apps/worker/seed/fixtures', name);
const output = (name) => resolve(root, 'docs/unified-platform', name);
const readJson = async (name) => JSON.parse(await readFile(fixture(name), 'utf8'));
const [positions, legacyPositions, legacyRules, credentials] = await Promise.all([
  readJson('final_2026_positions.json'),
  readJson('2026_positions.json'),
  readJson('2026_rules.json'),
  readJson('reference_credentials.json'),
]);
const byId = new Map(positions.map((position) => [position.id, position]));
const oldById = new Map(legacyPositions.map((position) => [position.id, position]));
const rulesById = new Map();
for (const rule of legacyRules) {
  const list = rulesById.get(rule.positionId) ?? [];
  list.push(rule);
  rulesById.set(rule.positionId, list);
}
const credentialCatalog = new Set(credentials.map((credential) => credential.name));
const chiefIds = new Set(['A211', 'B211', 'C211']);
const closedIds = new Set(['D201', 'D301', 'D401', 'D402']);
const workbookSha256 = '0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a';
const policySha256 = 'a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc';

function semanticKey(position) {
  return [
    position.shift,
    String(position.unit).trim(),
    position.positionName.trim(),
    position.rankRequired,
  ].join('|');
}

function credentialNames(rule) {
  return [
    ...(rule.requiredCriteria?.credentials ?? []),
    ...(rule.pointsPreference?.items ?? []).flatMap((item) =>
      typeof item.credential === 'string' ? [item.credential] : [],
    ),
  ];
}

function specialty(position) {
  const name = position.positionName.toUpperCase();
  if (name.includes('INV')) return 'FIRE_INVESTIGATOR';
  if (name.includes('AT')) return 'AIR_TECHNICIAN';
  if (name.includes('DE')) return 'DRIVER_ENGINEER';
  if (position.station === 'Station #6') return 'MARINE';
  if (position.unit === 'Captain 5') return 'CAPTAIN_5';
  return null;
}

const positionAudit = positions.map((position) => {
  const administrative = chiefIds.has(position.id);
  const union = position.id === 'A801';
  const closed = closedIds.has(position.id);
  const biddable = !administrative && !union && !closed;
  const directRules = rulesById.get(position.id) ?? [];
  const directRule = directRules[0] ?? null;
  const oldPosition = oldById.get(position.id);
  const directSemanticMatch =
    directRule !== null &&
    oldPosition !== undefined &&
    semanticKey(oldPosition) === semanticKey(position);
  const directRankMatch =
    directRule !== null &&
    directRule.requiredCriteria.rank.length === 1 &&
    directRule.requiredCriteria.rank[0] === position.rankRequired;
  return {
    position_id: position.id,
    shift: position.shift,
    station_or_pool: position.station,
    division: position.division,
    unit: position.unit,
    displayed_role: position.positionName,
    bid_rank: position.rankRequired,
    specialty: specialty(position),
    floating: position.isFloating,
    biddable,
    classification: administrative
      ? 'ADMINISTRATIVELY_ASSIGNED_NOT_BID'
      : union
        ? 'UNION_PRESIDENT_NOT_COUNTED_PENDING_BUSINESS_CLASSIFICATION'
        : closed
          ? 'CLOSED_2026_DAYS'
          : 'SOURCE_CANDIDATE_NOT_FINAL_VALIDATED',
    legacy_same_id_semantic_match: directSemanticMatch,
    legacy_same_id_rank_match: directRankMatch,
    legacy_same_id_rule: directRule?.positionId ?? null,
    final_rule_id: null,
    final_rule_status: biddable ? 'NOT_SEMANTICALLY_APPROVED' : 'NOT_APPLICABLE',
    source: {
      workbook: 'MASTER 2026 Bid Positions Selection V2.xlsx',
      workbook_sha256: workbookSha256,
      sheet: position.source?.sheet ?? null,
      row: position.source?.row ?? null,
      source_division: position.source?.sourceDivision ?? null,
      source_correction: position.source?.correction ?? null,
    },
    determination: administrative
      ? '2026-09-26 administrator direction'
      : union
        ? 'MASTER Positions row 75 identifies a Union President organizational seat; no authority to count it as an ordinary Bid opportunity'
        : closed
          ? 'Final July 2026 Bid Policy, procedures 4-6'
          : 'MASTER Positions row; final 73-seat reconciliation and rule validation pending',
  };
});

const ruleAudit = legacyRules.map((rule) => {
  const old = oldById.get(rule.positionId) ?? null;
  const sameId = byId.get(rule.positionId) ?? null;
  const exactCandidates =
    old === null
      ? []
      : positions
          .filter((position) => semanticKey(position) === semanticKey(old))
          .map((position) => position.id);
  const investigatorCandidate = old?.positionName.includes('INV') ? `${old.shift}305` : null;
  const policyCandidate =
    investigatorCandidate && byId.has(investigatorCandidate) ? investigatorCandidate : null;
  const unresolvedCredentials = [...new Set(credentialNames(rule))].filter(
    (name) => !credentialCatalog.has(name),
  );
  const rankMatch =
    sameId !== null &&
    rule.requiredCriteria.rank.length === 1 &&
    rule.requiredCriteria.rank[0] === sameId.rankRequired;
  const semanticMatch = old !== null && sameId !== null && semanticKey(old) === semanticKey(sameId);
  return {
    old_rule_id: rule.positionId,
    old_semantic_role:
      old === null
        ? null
        : {
            unit: old.unit,
            role: old.positionName,
            rank: old.rankRequired,
          },
    final_same_id_role:
      sameId === null
        ? null
        : {
            unit: sameId.unit,
            role: sameId.positionName,
            rank: sameId.rankRequired,
          },
    exact_semantic_candidate_ids: exactCandidates,
    policy_candidate_id: policyCandidate,
    semantic_match: semanticMatch,
    rank_match: rankMatch,
    requirements_match: 'NOT_POLICY_REVALIDATED',
    unresolved_credential_literals: unresolvedCredentials,
    action: chiefIds.has(rule.positionId)
      ? 'REMOVE_FROM_NEW_BID_RULE_BOOK'
      : !semanticMatch || !rankMatch || unresolvedCredentials.length > 0
        ? 'REAUTHOR_AND_REVIEW_BY_SEMANTIC_ROLE'
        : 'REVALIDATE_REQUIREMENTS_AGAINST_FINAL_POLICY',
    authority: policyCandidate
      ? 'Final July 2026 Bid Policy p2 procedure 3(e); MASTER Positions INV role'
      : 'MASTER Positions source role and final July 2026 Bid Policy',
  };
});

const counts = Object.fromEntries(
  ['A', 'B', 'C', 'D'].map((shift) => [
    shift,
    positionAudit.filter((position) => position.shift === shift && position.biddable).length,
  ]),
);
const blockingIssues = [
  ...['A', 'B', 'C']
    .filter((shift) => counts[shift] !== 73)
    .map((shift) => `${shift}_NON_DC_BID_SEATS_${counts[shift]}_EXPECTED_73`),
  'A801_UNION_PRESIDENT_CLASSIFICATION_REQUIRES_APPROVED_BUSINESS_DECISION',
  'FINAL_RULE_BOOK_NOT_SEMANTICALLY_RECONCILED',
];
const common = {
  audit_status: 'SOURCE_AUDIT_ONLY_NOT_AN_EXECUTABLE_2026_CONFIGURATION',
  source_hashes: { master_workbook: workbookSha256, final_policy: policySha256 },
  fixture_sha256: createHash('sha256')
    .update(await readFile(fixture('final_2026_positions.json')))
    .digest('hex'),
};
await writeFile(
  output('2026-source-opportunity-audit.json'),
  `${JSON.stringify({ ...common, biddable_counts: counts, blocking_issues: blockingIssues, positions: positionAudit }, null, 2)}\n`,
);
await writeFile(
  output('2026-legacy-rule-semantic-audit.json'),
  `${JSON.stringify({ ...common, rule_count: ruleAudit.length, rules: ruleAudit }, null, 2)}\n`,
);
// Keep generated manifests byte-stable with the repository formatter so a
// source audit can be rerun without leaving a lint failure or noisy diff.
const biome = resolve(root, 'node_modules/@biomejs/biome/bin/biome');
const formatted = spawnSync(
  process.execPath,
  [
    biome,
    'format',
    '--write',
    output('2026-source-opportunity-audit.json'),
    output('2026-legacy-rule-semantic-audit.json'),
  ],
  { cwd: root, encoding: 'utf8' },
);
if (formatted.status !== 0) {
  throw new Error(`Cannot format generated audits: ${formatted.stderr || formatted.error}`);
}
