import { bidContentHash } from './bid-definition-content.js';
import { BidDefinitionSnapshotPinSchema } from './bid-definition-pin.js';
import { escapeCsvField } from './csv-stream.js';
import { loadFinalResultSource } from './final-result-source.js';
import { loadOfficialAnnualCompletion } from './official-annual-completion.js';

/** A deterministic download projection, not a publication action or mutable roster. */
export async function loadCanonicalBidResultPackage(db: D1Database, sessionId: string) {
  const official = await loadOfficialAnnualCompletion(db, sessionId);
  if (!official.ok) return official;
  const { snapshot, completion } = official;
  if (snapshot.v !== 3) return { ok: false as const, error: 'frozen_material_required' };
  const pin =
    'bidDefinition' in snapshot
      ? BidDefinitionSnapshotPinSchema.safeParse(snapshot.bidDefinition)
      : null;
  const operations =
    snapshot.settings.v === 3 ? snapshot.settings.livePolicy.annualOperations : undefined;
  const awards = [];
  for (const award of completion.participants) {
    const member = snapshot.operatorIdentityProjection?.find(
      (item) => item.memberId === award.memberId,
    );
    if (!member) return { ok: false as const, error: 'frozen_member_identity_missing' };
    const pool = operations?.opportunityPools?.find((item) =>
      item.positionIds.includes(award.positionId),
    );
    awards.push({
      ...award,
      name: [member.firstName, member.lastName].filter(Boolean).join(' '),
      pool: pool
        ? {
            id: pool.id,
            label: pool.label,
            sourceRef: pool.sourceRef,
            sourceDecisionId: pool.sourceDecisionId,
          }
        : null,
      memberships: (operations?.membershipDistributions ?? [])
        .filter((item) =>
          item.membershipSource === 'REVIEWED_QUALIFIED_POOL'
            ? award.membershipIds?.includes(item.id)
            : item.memberIds.includes(award.memberId),
        )
        .map((item) => ({ id: item.id, label: item.label })),
    });
  }
  const document = {
    format: 'MBFD_FINAL_BID_RESULTS_V1',
    sessionId,
    bidYear: completion.bidYear,
    mode: 'LIVE',
    completion: completion.completion,
    provenance: { ...completion.frozen, pin: pin?.success ? pin.data : null },
    externalPublication: 'REQUIRED_SEPARATELY',
    awards,
  };
  const serialized = JSON.stringify(document);
  return { ok: true as const, document, serialized, packageSha256: bidContentHash(serialized) };
}

export async function loadBidResultPackage(db: D1Database, sessionId: string) {
  const value = await loadCanonicalBidResultPackage(db, sessionId);
  if (!value.ok) return value;
  const source = await loadFinalResultSource(db, sessionId, value.document.completion.revision);
  if (!source) return value;
  const rows = new Map(source.rows.map((row) => [row.position_id, row]));
  const document = {
    ...value.document,
    finalSource: {
      publicationId: source.publicationId,
      workbookSha256: source.workbookSha256,
      manifestSha256: source.manifestSha256,
      canonicalResultSha256: source.canonicalResultSha256,
    },
    awards: value.document.awards.map((award) => {
      const row = rows.get(award.positionId);
      return row
        ? {
            ...award,
            position: row.position_label,
            division: row.division_label,
            bidSelection: row.bid_selection_label,
            assignmentSource: row.assignment_source,
          }
        : award;
    }),
    retainedAssignments: source.rows
      .filter((row) => row.assignment_source === 'retained_nonbiddable')
      .map(({ employee_id: _employeeId, ...row }) => row),
  };
  const serialized = JSON.stringify(document);
  return { ok: true as const, document, serialized, packageSha256: bidContentHash(serialized) };
}

/** Neutralize spreadsheet formula prefixes in free-text frozen labels. */
function csvText(value: string | null) {
  return value !== null && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
}
export function bidResultPackageCsv(
  value: Extract<Awaited<ReturnType<typeof loadBidResultPackage>>, { ok: true }>,
) {
  const rows: unknown[][] = [
    [
      'package_sha256',
      'session_id',
      'bid_year',
      'completion_revision',
      'member_id',
      'name',
      'position_id',
      'position',
      'rank',
      'shift',
      'station',
      'unit',
      'a_day',
      'pool',
      'memberships',
    ],
  ];
  for (const award of value.document.awards)
    rows.push([
      value.packageSha256,
      csvText(value.document.sessionId),
      value.document.bidYear,
      value.document.completion.revision,
      award.memberId,
      csvText(award.name),
      csvText(award.positionId),
      csvText(award.position),
      csvText(award.rank),
      csvText(award.shift),
      csvText(award.station),
      csvText(award.unit),
      csvText(award.aDay),
      csvText(award.pool?.label ?? null),
      csvText(award.memberships.map((item) => item.label).join('; ')),
    ]);
  return `${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}
