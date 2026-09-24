const BASELINE_SHEET = '2026_BID_Credentials_Version_1_';

function csvCell(value: unknown): string {
  const text =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value === null || value === undefined
        ? ''
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function credentialRowsToCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export async function credentialSourceText(file: File): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) return file.text();
  const { default: readWorkbook } = await import('read-excel-file/browser');
  const sheets = await readWorkbook(file);
  const baseline = sheets.find((sheet) => sheet.sheet === BASELINE_SHEET);
  if (!baseline)
    throw new Error(`The workbook does not contain the approved ${BASELINE_SHEET} sheet.`);
  return credentialRowsToCsv(baseline.data);
}
