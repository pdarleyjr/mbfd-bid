import Papa from 'papaparse';
import type { ZodType, ZodTypeDef } from 'zod';

export type CsvParseResult<T> = {
  ok: T[];
  errors: { rowNumber: number; raw: unknown; message: string }[];
};

/**
 * Parses a CSV string and validates each row against a Zod schema.
 * Rows that fail validation are collected as errors instead of throwing.
 * Header names are lower-cased with whitespace converted to underscores.
 * BOM characters are stripped automatically by papaparse.
 */
export async function parseCsv<T>(
  input: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<CsvParseResult<T>> {
  const parsed = Papa.parse<Record<string, unknown>>(input, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const ok: T[] = [];
  const errors: CsvParseResult<T>['errors'] = [];

  parsed.data.forEach((row, i) => {
    const result = schema.safeParse(row);
    if (result.success) {
      ok.push(result.data);
    } else {
      errors.push({
        rowNumber: i + 2, // row 1 is the header, data rows start at 2
        raw: row,
        message: result.error.message,
      });
    }
  });

  return { ok, errors };
}
