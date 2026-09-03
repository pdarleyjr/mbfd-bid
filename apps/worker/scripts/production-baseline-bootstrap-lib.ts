import type Database from 'better-sqlite3';

type SqliteDb = Pick<Database.Database, 'prepare'>;
type SqlRow = Record<string, null | number | string>;

const TABLE_ORDER = [
  'members',
  'credentials',
  'staffing_positions',
  'staffing_position_source_mappings',
  'member_credentials',
  'member_qualification_events',
] as const;

type BaselineTable = (typeof TABLE_ORDER)[number];

export interface ProductionBaselinePlan {
  sourceHash: string;
  asOf: string;
  rows: Record<BaselineTable, SqlRow[]>;
  summary: {
    matchedMembers: number;
    staffingPositions: number;
    sourceMappings: number;
    credentials: number;
    memberCredentialReferences: number;
    qualificationEvidence: number;
    insertsRequired: number;
  };
}

function rows(db: SqliteDb, sql: string, ...bindings: Array<number | string>): SqlRow[] {
  return db.prepare(sql).all(...bindings) as SqlRow[];
}

function rowMatches(left: SqlRow, right: SqlRow): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function existingBy(
  db: SqliteDb,
  table: BaselineTable,
  predicates: readonly string[],
  values: readonly (number | string)[],
): SqlRow | undefined {
  return db
    .prepare(`SELECT * FROM "${table}" WHERE ${predicates.join(' OR ')} LIMIT 1`)
    .get(...values) as SqlRow | undefined;
}

function pendingRows(db: SqliteDb, table: BaselineTable, sourceRows: SqlRow[]): SqlRow[] {
  return sourceRows.filter((row) => {
    let existing: SqlRow | undefined;
    switch (table) {
      case 'members':
        existing = existingBy(
          db,
          table,
          ['id = ?', 'employee_id = ?'],
          [row.id as number, row.employee_id as string],
        );
        if (existing !== undefined && !rowMatches(existing, row)) {
          throw new Error('PRODUCTION_MEMBER_EMPLOYEE_ID_CONFLICT');
        }
        break;
      case 'credentials':
        existing = existingBy(
          db,
          table,
          ['id = ?', 'name = ?'],
          [row.id as number, row.name as string],
        );
        if (existing !== undefined && !rowMatches(existing, row)) {
          throw new Error('PRODUCTION_CREDENTIAL_CONFLICT');
        }
        break;
      case 'staffing_positions':
        existing = existingBy(
          db,
          table,
          ['id = ?', 'stable_slot_key = ?'],
          [row.id as string, row.stable_slot_key as string],
        );
        if (existing !== undefined && !rowMatches(existing, row)) {
          throw new Error('PRODUCTION_STAFFING_POSITION_CONFLICT');
        }
        break;
      case 'staffing_position_source_mappings':
        existing = existingBy(
          db,
          table,
          [
            'id = ?',
            '(source_system = ? AND source_locator = ? AND source_discriminator = ? AND effective_from = ?)',
          ],
          [
            row.id as string,
            row.source_system as string,
            row.source_locator as string,
            row.source_discriminator as string,
            row.effective_from as string,
          ],
        );
        if (existing !== undefined && !rowMatches(existing, row)) {
          throw new Error('PRODUCTION_SOURCE_MAPPING_CONFLICT');
        }
        break;
      case 'member_credentials':
        existing = existingBy(
          db,
          table,
          ['(member_id = ? AND credential_id = ?)'],
          [row.member_id as number, row.credential_id as number],
        );
        if (existing !== undefined && !rowMatches(existing, row)) {
          throw new Error('PRODUCTION_MEMBER_CREDENTIAL_CONFLICT');
        }
        break;
      case 'member_qualification_events':
        existing = existingBy(
          db,
          table,
          ['id = ?', 'idempotency_key = ?'],
          [row.id as string, row.idempotency_key as string],
        );
        if (existing !== undefined && !rowMatches(existing, row)) {
          throw new Error('PRODUCTION_QUALIFICATION_EVIDENCE_CONFLICT');
        }
        break;
    }
    return existing === undefined;
  });
}

export function planProductionBaseline(
  reference: SqliteDb,
  production: SqliteDb,
  sourceHash: string,
  options: { asOf?: string } = {},
): ProductionBaselinePlan {
  const manifests = rows(
    reference,
    `SELECT id, source_snapshot_as_of FROM assignment_imports
      WHERE source_hash = ? AND source_kind = 'official' AND status = 'committed'
      ORDER BY id`,
    sourceHash,
  );
  if (manifests.length !== 1) throw new Error('REFERENCE_OFFICIAL_MANIFEST_NOT_UNIQUE');
  const manifestId = manifests[0]?.id;
  if (typeof manifestId !== 'string') throw new Error('REFERENCE_OFFICIAL_MANIFEST_INVALID');
  const asOf = options.asOf ?? manifests[0]?.source_snapshot_as_of;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error('REFERENCE_SOURCE_SNAPSHOT_AS_OF_INVALID');
  }

  const matchedMembers = rows(
    reference,
    `SELECT DISTINCT member_record.*
       FROM assignment_import_rows source_row
       JOIN members member_record ON member_record.id = source_row.resolved_member_id
      WHERE source_row.import_id = ?
      ORDER BY member_record.id`,
    manifestId,
  );
  if (matchedMembers.length === 0) throw new Error('REFERENCE_HAS_NO_MATCHED_MEMBERS');

  const staffingPositions = rows(
    reference,
    `SELECT DISTINCT position_record.*
       FROM staffing_positions position_record
      WHERE position_record.review_status = 'approved'
        AND (position_record.active_from IS NULL OR position_record.active_from <= ?)
        AND (position_record.active_to IS NULL OR position_record.active_to >= ?)
        AND (
          EXISTS (
            SELECT 1
              FROM assignment_import_rows source_row
              JOIN staffing_position_source_mappings source_mapping
                ON source_mapping.id = source_row.staffing_position_source_mapping_id
             WHERE source_row.import_id = ?
               AND source_mapping.staffing_position_id = position_record.id
          )
          OR (
            EXISTS (
              SELECT 1 FROM personnel_lifecycle_events created_event
               WHERE created_event.staffing_position_id = position_record.id
                 AND created_event.kind = 'POSITION_CREATE'
                 AND created_event.origin = 'ADMIN'
                 AND created_event.effective_on <= ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM personnel_lifecycle_events retired_event
               WHERE retired_event.staffing_position_id = position_record.id
                 AND retired_event.kind = 'POSITION_RETIRE'
                 AND retired_event.effective_on <= ?
            )
          )
        )
      ORDER BY position_record.id`,
    asOf,
    asOf,
    manifestId,
    asOf,
    asOf,
  );
  const selectedPositionIds = new Set(staffingPositions.map((position) => position.id));
  const sourceMappings = rows(
    reference,
    `SELECT * FROM staffing_position_source_mappings
      WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY id`,
    asOf,
    asOf,
  ).filter((mapping) => selectedPositionIds.has(mapping.staffing_position_id));
  const credentials = rows(reference, 'SELECT * FROM credentials ORDER BY id');
  const memberCredentials = rows(
    reference,
    `SELECT member_credential.*
       FROM member_credentials member_credential
       JOIN assignment_import_rows source_row ON source_row.resolved_member_id = member_credential.member_id
      WHERE source_row.import_id = ?
      GROUP BY member_credential.member_id, member_credential.credential_id
      ORDER BY member_credential.member_id, member_credential.credential_id`,
    manifestId,
  );
  const qualificationEvidence = rows(
    reference,
    `SELECT qualification.*
       FROM member_qualification_events qualification
       JOIN assignment_import_rows source_row ON source_row.resolved_member_id = qualification.member_id
      WHERE source_row.import_id = ?
      GROUP BY qualification.id
      ORDER BY qualification.id`,
    manifestId,
  );

  const plannedRows: Record<BaselineTable, SqlRow[]> = {
    members: pendingRows(production, 'members', matchedMembers),
    credentials: pendingRows(production, 'credentials', credentials),
    staffing_positions: pendingRows(production, 'staffing_positions', staffingPositions),
    staffing_position_source_mappings: pendingRows(
      production,
      'staffing_position_source_mappings',
      sourceMappings,
    ),
    member_credentials: pendingRows(production, 'member_credentials', memberCredentials),
    member_qualification_events: pendingRows(
      production,
      'member_qualification_events',
      qualificationEvidence,
    ),
  };
  const insertsRequired = TABLE_ORDER.reduce(
    (count, table) => count + plannedRows[table].length,
    0,
  );

  return {
    sourceHash,
    asOf,
    rows: plannedRows,
    summary: {
      matchedMembers: matchedMembers.length,
      staffingPositions: staffingPositions.length,
      sourceMappings: sourceMappings.length,
      credentials: credentials.length,
      memberCredentialReferences: memberCredentials.length,
      qualificationEvidence: qualificationEvidence.length,
      insertsRequired,
    },
  };
}

function sqlLiteral(value: SqlRow[string]): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_SQL_VALUE');
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildProductionBaselineSql(plan: ProductionBaselinePlan): string {
  if (plan.summary.insertsRequired === 0) return '-- no-op: production baseline already matches\n';
  const statements = [
    '-- Generated transiently by production-baseline-bootstrap.ts.',
    '-- Contains reviewed canonical data; do not commit this file.',
  ];
  for (const table of TABLE_ORDER) {
    for (const row of plan.rows[table]) {
      const columns = Object.keys(row);
      const columnSql = columns.map((column) => `"${column}"`).join(',');
      const valueSql = columns.map((column) => sqlLiteral(row[column] ?? null)).join(',');
      statements.push(`INSERT INTO "${table}" (${columnSql}) VALUES (${valueSql});`);
    }
  }
  return `${statements.join('\n')}\n`;
}
