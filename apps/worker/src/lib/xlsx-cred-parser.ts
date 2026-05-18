import { type CredentialImportRow, CredentialImportRowSchema } from '@mbfd/shared';
import * as XLSX from 'xlsx';

export type XlsxParseResult<T> = {
  ok: T[];
  errors: { rowNumber: number; raw: unknown; message: string }[];
};

/**
 * Parses a normalized credentials workbook (one row per credential).
 * Headers are lower-cased with whitespace replaced by underscores before
 * Zod validation.
 */
export function parseCredentialsXlsx(
  buf: ArrayBuffer | Uint8Array,
): XlsxParseResult<CredentialImportRow> {
  const wb = XLSX.read(buf, { type: 'array' });
  const firstName = wb.SheetNames[0];
  if (!firstName) {
    return { ok: [], errors: [{ rowNumber: 0, raw: null, message: 'empty workbook' }] };
  }
  const sheet = wb.Sheets[firstName];
  if (!sheet) {
    return { ok: [], errors: [{ rowNumber: 0, raw: null, message: 'sheet not found' }] };
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const ok: CredentialImportRow[] = [];
  const errors: XlsxParseResult<CredentialImportRow>['errors'] = [];
  rows.forEach((rawRow, i) => {
    const normalized = Object.fromEntries(
      Object.entries(rawRow).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), v]),
    );
    const result = CredentialImportRowSchema.safeParse(normalized);
    if (result.success) {
      ok.push(result.data);
    } else {
      errors.push({ rowNumber: i + 2, raw: rawRow, message: result.error.message });
    }
  });
  return { ok, errors };
}

export type WideMatrixOptions = { metadataColumns: number };

/**
 * Extracts credential NAMES from the header row of a legacy wide-matrix
 * workbook (credentials as columns). Skips the first `metadataColumns`
 * header cells. Returns rows with `fyPointsDefault: 0` since the points
 * live elsewhere in this legacy shape.
 */
export function parseLegacyWideMatrix(
  buf: ArrayBuffer | Uint8Array,
  opts: WideMatrixOptions,
): XlsxParseResult<CredentialImportRow> {
  const wb = XLSX.read(buf, { type: 'array' });
  const firstName = wb.SheetNames[0];
  if (!firstName) {
    return { ok: [], errors: [{ rowNumber: 0, raw: null, message: 'empty workbook' }] };
  }
  const sheet = wb.Sheets[firstName];
  if (!sheet) {
    return { ok: [], errors: [{ rowNumber: 0, raw: null, message: 'sheet not found' }] };
  }
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const header = rows[0];
  if (!Array.isArray(header)) {
    return { ok: [], errors: [{ rowNumber: 1, raw: null, message: 'missing header row' }] };
  }
  const seen = new Set<string>();
  const ok: CredentialImportRow[] = [];
  const errors: XlsxParseResult<CredentialImportRow>['errors'] = [];
  for (let i = opts.metadataColumns; i < header.length; i += 1) {
    const cell = header[i];
    const name = typeof cell === 'string' ? cell.trim() : String(cell ?? '').trim();
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
