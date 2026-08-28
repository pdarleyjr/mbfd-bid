import type {
  ParsedTeleStaffAssignmentsHtml,
  TeleStaffAssignmentsHtmlParseResult,
} from './telestaff-assignment-html.js';

export type TeleStaffHtmlStagingErrorCode =
  | 'SOURCE_PARSE_REJECTED'
  | 'INVALID_IMPORT_ID'
  | 'INVALID_SOURCE_KIND'
  | 'INVALID_EMPLOYEE_REFERENCE_HMAC'
  | 'DUPLICATE_EMPLOYEE_REFERENCE_HMAC'
  | 'INVALID_ROW_FINGERPRINT_HMAC'
  | 'DUPLICATE_ROW_FINGERPRINT_HMAC';

export type TeleStaffSourceKind = 'official' | 'synthetic_test';

export interface TeleStaffHtmlStagingOptions {
  /** Server-generated ULID import identifier; never an Emp ID or filename. */
  importId: string;
  /**
   * Externally governed ingestion designation, not proof that the bytes are
   * authoritative. This local helper has no HTTP route; a future authorized
   * workflow must select `official` only after source-policy approval.
   */
  sourceKind: TeleStaffSourceKind;
  /** Import observation time, explicitly distinct from assignment effective dates. */
  importedAtMs: number;
  /**
   * Caller-owned keyed HMAC operation. The adapter never receives the key and
   * no raw Emp ID is persisted. Return a SHA-256 hex digest.
   */
  hmacEmployeeReference(employeeId: string): Promise<string>;
  /**
   * Separate keyed HMAC domain for a canonical raw source row. The adapter's
   * transient plain digest is never persisted.
   */
  hmacRowFingerprint(canonicalSourceRow: string): Promise<string>;
}

export type TeleStaffHtmlStagingResult =
  | {
      ok: true;
      importId: string;
      sourceFormat: 'TELSTAFF_ASSIGNMENTS_HTML_V1';
      sourceKind: TeleStaffSourceKind;
      inputRowCount: number;
      reportRowCount: number;
      structuralRowCount: number;
    }
  | { ok: false; code: TeleStaffHtmlStagingErrorCode };

interface SanitizedStagedRow {
  id: string;
  sourceRowNumber: number;
  rowFingerprint: string;
  employeeReferenceHmac: string | null;
  sourceARDay: string | null;
  normalizedTopology: string;
  topologyCompleteness: 'complete' | 'incomplete';
  disposition: 'unknown_employee' | 'ambiguous_mapping';
  classification: 'UNKNOWN_EMPLOYEE' | 'AMBIGUOUS_MAPPING' | 'INCOMPLETE_TOPOLOGY';
}

function isCanonicalUlid(value: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value);
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isSourceKind(value: string): value is TeleStaffSourceKind {
  return value === 'official' || value === 'synthetic_test';
}

function canonicalSourceRowForHmac(row: ParsedTeleStaffAssignmentsHtml['rows'][number]): string {
  return JSON.stringify({
    schema: 'telestaff-assignment-row-hmac-v1',
    sourceName: row.sourceName,
    employeeId: row.employeeId,
    shift: row.shift,
    division: row.division,
    station: row.station,
    unit: row.unit,
    position: row.position,
    sourceARDay: row.sourceARDay,
  });
}

function stagedClassification(
  row: ParsedTeleStaffAssignmentsHtml['rows'][number],
): Pick<SanitizedStagedRow, 'disposition' | 'classification'> {
  if (row.employeeId === null) {
    return { disposition: 'unknown_employee', classification: 'UNKNOWN_EMPLOYEE' };
  }
  if (row.topologyCompleteness === 'incomplete') {
    return { disposition: 'ambiguous_mapping', classification: 'INCOMPLETE_TOPOLOGY' };
  }
  // A source observation is not a canonical slot assignment. In the absence
  // of an independently approved mapping, preserve the row as pending rather
  // than deriving capacity from its Emp ID or display topology.
  return { disposition: 'ambiguous_mapping', classification: 'AMBIGUOUS_MAPPING' };
}

/**
 * Persists a parser result as immutable, sanitized source evidence only. This
 * internal service deliberately has no HTTP route: authorization, key custody,
 * review, and audit lifecycle remain separate controls.
 */
export async function stageParsedTeleStaffAssignmentsHtml(
  d1: D1Database,
  parsed: TeleStaffAssignmentsHtmlParseResult,
  options: TeleStaffHtmlStagingOptions,
): Promise<TeleStaffHtmlStagingResult> {
  if (!parsed.ok) return { ok: false, code: 'SOURCE_PARSE_REJECTED' };
  if (!isCanonicalUlid(options.importId)) return { ok: false, code: 'INVALID_IMPORT_ID' };
  if (!isSourceKind(options.sourceKind)) return { ok: false, code: 'INVALID_SOURCE_KIND' };

  let employeeReferenceHmacs: Array<string | null>;
  try {
    employeeReferenceHmacs = await Promise.all(
      parsed.rows.map(async (row) => {
        if (row.employeeId === null) return null;
        const hmac = await options.hmacEmployeeReference(row.employeeId);
        return isSha256Hex(hmac) ? hmac.toLowerCase() : null;
      }),
    );
  } catch {
    return { ok: false, code: 'INVALID_EMPLOYEE_REFERENCE_HMAC' };
  }

  let rowFingerprintHmacs: string[];
  try {
    rowFingerprintHmacs = await Promise.all(
      parsed.rows.map(async (row) => {
        const hmac = await options.hmacRowFingerprint(canonicalSourceRowForHmac(row));
        return isSha256Hex(hmac) ? hmac.toLowerCase() : '';
      }),
    );
  } catch {
    return { ok: false, code: 'INVALID_ROW_FINGERPRINT_HMAC' };
  }
  if (
    parsed.rows.some(
      (row, index) => row.employeeId !== null && employeeReferenceHmacs[index] === null,
    )
  ) {
    return { ok: false, code: 'INVALID_EMPLOYEE_REFERENCE_HMAC' };
  }
  const hmacs = employeeReferenceHmacs.filter((value): value is string => value !== null);
  if (new Set(hmacs).size !== hmacs.length) {
    return { ok: false, code: 'DUPLICATE_EMPLOYEE_REFERENCE_HMAC' };
  }
  if (rowFingerprintHmacs.some((value) => !isSha256Hex(value))) {
    return { ok: false, code: 'INVALID_ROW_FINGERPRINT_HMAC' };
  }
  if (new Set(rowFingerprintHmacs).size !== rowFingerprintHmacs.length) {
    return { ok: false, code: 'DUPLICATE_ROW_FINGERPRINT_HMAC' };
  }

  const rows: SanitizedStagedRow[] = parsed.rows.map((row, index) => {
    const classification = stagedClassification(row);
    return {
      id: `${options.importId}:row:${row.sourceRowNumber}`,
      sourceRowNumber: row.sourceRowNumber,
      rowFingerprint: rowFingerprintHmacs[index] ?? '',
      employeeReferenceHmac: employeeReferenceHmacs[index] ?? null,
      sourceARDay: row.sourceARDay,
      normalizedTopology: row.normalizedTopology,
      topologyCompleteness: row.topologyCompleteness,
      ...classification,
    };
  });

  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `INSERT INTO assignment_imports
           (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
            input_row_count, normalized_data_row_count, unique_employee_count, report_row_count, structural_row_count,
            source_snapshot_as_of, status, created_at)
         VALUES (?, 'telestaff', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)`,
      )
      .bind(
        options.importId,
        parsed.sourceFormat,
        parsed.sourceHash,
        parsed.sourceFormat,
        parsed.parserVersion,
        options.sourceKind,
        parsed.inputRowCount,
        parsed.normalizedDataRowCount,
        parsed.uniqueEmployeeCount,
        parsed.reportRowCount,
        parsed.structuralRowCount,
        parsed.sourceSnapshotAsOf,
        options.importedAtMs,
      ),
  ];
  for (const row of rows) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO assignment_import_rows
             (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
              source_a_r_day, normalized_source_topology, source_topology_completeness,
              disposition, reconciliation_classification, review_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .bind(
          row.id,
          options.importId,
          row.sourceRowNumber,
          row.rowFingerprint,
          row.employeeReferenceHmac,
          row.sourceARDay,
          row.normalizedTopology,
          row.topologyCompleteness,
          row.disposition,
          row.classification,
          options.importedAtMs,
        ),
    );
  }
  await d1.batch(statements);

  return {
    ok: true,
    importId: options.importId,
    sourceFormat: parsed.sourceFormat,
    sourceKind: options.sourceKind,
    inputRowCount: parsed.inputRowCount,
    reportRowCount: parsed.reportRowCount,
    structuralRowCount: parsed.structuralRowCount,
  };
}
