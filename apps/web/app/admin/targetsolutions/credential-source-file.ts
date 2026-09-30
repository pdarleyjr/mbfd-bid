const REVISION_SHEET = /^2026_BID_Credentials_Version_(\d+)_$/;

export type CredentialRevision = {
  sheet: string;
  revision: number;
  data: unknown[][];
  rowCount: number;
  employeeCount: number;
};
export type CredentialWorkbook = { hash: string; revisions: CredentialRevision[] };

export function discoverCredentialRevisions(
  sheets: readonly { sheet: string; data: unknown[][] }[],
): CredentialRevision[] {
  return sheets
    .flatMap(({ sheet, data }) => {
      const match = REVISION_SHEET.exec(sheet);
      if (!match) return [];
      const header = data[0] ?? [];
      const employeeColumn = header.findIndex(
        (value) =>
          String(value)
            .replace(/[^a-z0-9]/gi, '')
            .toLowerCase() === 'employeeid',
      );
      if (employeeColumn < 0) throw new Error(`${sheet} has no Employee ID header.`);
      const records = data
        .slice(1)
        .filter((row) => row.some((value) => value != null && value !== ''));
      return [
        {
          sheet,
          revision: Number(match[1]),
          data,
          rowCount: records.length,
          employeeCount: new Set(records.map((row) => String(row[employeeColumn]))).size,
        },
      ];
    })
    .sort((a, b) => b.revision - a.revision);
}

export async function readCredentialWorkbook(file: File): Promise<CredentialWorkbook> {
  const { default: readWorkbook } = await import('read-excel-file/browser');
  const revisions = discoverCredentialRevisions(await readWorkbook(file));
  if (!revisions.length)
    throw new Error('The workbook contains no numbered 2026 Bid credential revision.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return {
    hash: Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(''),
    revisions,
  };
}

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
  const dateColumns = new Set(
    (rows[0] ?? []).flatMap((value, index) =>
      ['startdate', 'expirationdate'].includes(
        String(value)
          .replace(/[^a-z0-9]/gi, '')
          .toLowerCase(),
      )
        ? [index]
        : [],
    ),
  );
  return rows
    .map((row, rowIndex) =>
      row
        .map((value, column) =>
          csvCell(
            rowIndex > 0 &&
              dateColumns.has(column) &&
              typeof value === 'string' &&
              /^\d{4}-\d{2}-\d{2} 00:00:00$/.test(value)
              ? value.slice(0, 10)
              : value,
          ),
        )
        .join(','),
    )
    .join('\r\n');
}

export async function credentialSourceText(file: File, selectedSheet?: string): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) return file.text();
  const { revisions } = await readCredentialWorkbook(file);
  if (!selectedSheet && revisions.length !== 1)
    throw new Error('Select a credential revision before importing this workbook.');
  const selected = revisions.find(
    (revision) => revision.sheet === (selectedSheet ?? revisions[0]?.sheet),
  );
  if (!selected)
    throw new Error(
      'The selected credential revision is absent. Choose a revision from this workbook.',
    );
  return credentialRowsToCsv(selected.data);
}
