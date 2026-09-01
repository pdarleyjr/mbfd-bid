import { type CredentialImportRow, CredentialImportRowSchema } from '@mbfd/shared';
import { readSheet } from 'read-excel-file/web-worker';

export type XlsxParseResult<T> = {
  ok: T[];
  errors: { rowNumber: number; raw: unknown; message: string }[];
};

function parseError(message: string): XlsxParseResult<CredentialImportRow> {
  return { ok: [], errors: [{ rowNumber: 0, raw: null, message }] };
}

function normalizedHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * Parses a normalized credentials workbook (one row per credential).
 *
 * `read-excel-file/web-worker` is intentionally used instead of a Node-only
 * reader so the same parser runs in the Workers runtime.
 */
export async function parseCredentialsXlsx(
  buf: ArrayBuffer,
): Promise<XlsxParseResult<CredentialImportRow>> {
  let rows: unknown[][];
  try {
    rows = await readSheet(buf);
  } catch {
    return parseError('invalid workbook');
  }
  const header = rows[0];
  if (!Array.isArray(header) || header.length === 0) return parseError('empty workbook');

  const headers = header.map(normalizedHeader);
  const ok: CredentialImportRow[] = [];
  const errors: XlsxParseResult<CredentialImportRow>['errors'] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((value) => value === null || value === undefined || value === '')) continue;
    const rawRow = Object.fromEntries(
      headers.filter(Boolean).map((key, column) => [key, row[column] ?? '']),
    );
    const result = CredentialImportRowSchema.safeParse(rawRow);
    if (result.success) {
      ok.push(result.data);
    } else {
      errors.push({ rowNumber: index + 1, raw: rawRow, message: result.error.message });
    }
  }
  return { ok, errors };
}

export type WideMatrixOptions = { metadataColumns: number };

/**
 * Extracts credential names from the header row of a legacy wide-matrix
 * workbook (credentials as columns). Skips the first `metadataColumns`
 * header cells. Returns rows with `fyPointsDefault: 0` since the points
 * live elsewhere in this legacy shape.
 */
export async function parseLegacyWideMatrix(
  buf: ArrayBuffer,
  opts: WideMatrixOptions,
): Promise<XlsxParseResult<CredentialImportRow>> {
  let rows: unknown[][];
  try {
    rows = await readSheet(buf);
  } catch {
    return parseError('invalid workbook');
  }
  const header = rows[0];
  if (!Array.isArray(header)) return parseError('missing header row');

  const seen = new Set<string>();
  const ok: CredentialImportRow[] = [];
  const errors: XlsxParseResult<CredentialImportRow>['errors'] = [];
  for (let i = opts.metadataColumns; i < header.length; i += 1) {
    const name = String(header[i] ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = CredentialImportRowSchema.safeParse({ name, fy_points_default: 0 });
    if (parsed.success) {
      ok.push(parsed.data);
    } else {
      errors.push({ rowNumber: 1, raw: name, message: parsed.error.message });
    }
  }
  return { ok, errors };
}
