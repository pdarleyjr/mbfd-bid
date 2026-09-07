import { describe, expect, it } from 'vitest';
import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { parseCredentialsXlsx, parseLegacyWideMatrix } from '../src/lib/xlsx-cred-parser.js';

async function toArrayBuffer(rows: SheetData): Promise<ArrayBuffer> {
  const output = await writeXlsxFile(rows);
  const bytes = await output.toBuffer();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function buildXlsx(rows: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return toArrayBuffer([
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? '')),
  ] as SheetData);
}

describe('parseCredentialsXlsx (normalized)', () => {
  it('preserves actual column positions around blank headers and rejects ambiguous duplicate headers', async () => {
    const result = await parseCredentialsXlsx(
      await toArrayBuffer([
        ['', 'name', '', 'fy_points_default'],
        ['ignored', 'Synthetic Qualification', 'ignored', 6],
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toEqual([
      { name: 'Synthetic Qualification', fyPointsDefault: 6, abbreviation: null, notes: null },
    ]);
    const duplicate = await parseCredentialsXlsx(
      await toArrayBuffer([
        ['name', 'Name', 'fy_points_default'],
        ['Synthetic one', 'Synthetic other', 6],
      ]),
    );
    expect(duplicate.ok).toEqual([]);
    expect(duplicate.errors[0]?.message).toBe('duplicate normalized column header');
  });
  it('parses a clean normalized workbook', async () => {
    const buf = await buildXlsx([
      { name: 'Driver Engineer Qualified', fy_points_default: 4 },
      { name: 'Hazmat Tech', fy_points_default: 6 },
      { name: 'Acting Lt', fy_points_default: 0 },
    ]);
    const result = await parseCredentialsXlsx(buf);
    expect(result.ok).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.ok[0]?.name).toBe('Driver Engineer Qualified');
    expect(result.ok[0]?.fyPointsDefault).toBe(4);
  });

  it('rejects empty name', async () => {
    const buf = await buildXlsx([{ name: '', fy_points_default: 1 }]);
    const result = await parseCredentialsXlsx(buf);
    expect(result.ok).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('defaults fy_points_default to 0 when missing', async () => {
    const buf = await buildXlsx([{ name: 'Hazmat Awareness' }]);
    const result = await parseCredentialsXlsx(buf);
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.fyPointsDefault).toBe(0);
  });
});

describe('parseLegacyWideMatrix', () => {
  it('rejects worksheets without qualification headers after the metadata columns', async () => {
    const result = await parseLegacyWideMatrix(
      await toArrayBuffer([['Synthetic rule title', '', '', '']]),
      { metadataColumns: 4 },
    );
    expect(result.ok).toEqual([]);
    expect(result.errors[0]?.message).toBe(
      'no qualification headers after metadata columns; verify the worksheet format',
    );
  });

  it('extracts credential names from header row of wide-matrix sheet', async () => {
    const buf = await toArrayBuffer([
      [
        'Employee Id',
        'Last Name',
        'First Name',
        'Driver Engineer Qualified',
        'Hazmat Tech',
        'Acting Lt',
      ],
      ['14335', 'Sola', 'Jesus', 4, 0, 6],
      ['18156', 'Abello', 'Digna', 0, 0, 0],
    ]);
    const result = await parseLegacyWideMatrix(buf, { metadataColumns: 3 });
    expect(result.ok).toHaveLength(3);
    expect(result.ok.map((c) => c.name)).toEqual([
      'Driver Engineer Qualified',
      'Hazmat Tech',
      'Acting Lt',
    ]);
    expect(result.ok.every((c) => c.fyPointsDefault === 0)).toBe(true);
  });

  it('reports duplicate credential headers for review instead of silently accepting them', async () => {
    const buf = await toArrayBuffer([
      ['Emp Id', 'Driver Engineer Qualified', ' driver engineer qualified ', 'Acting Lt'],
      ['14335', 4, 4, 6],
    ]);
    const result = await parseLegacyWideMatrix(buf, { metadataColumns: 1 });
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('Duplicate qualification header');
  });
});

describe('historical workbook format verification', () => {
  it.skipIf(!process.env.LOCAL_GOLDEN_TESTS)(
    'rejects the actual 2025 narrative rule workbook as a wide qualification matrix',
    async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const file = path.resolve(
        process.env.LOCAL_GOLDEN_WORKBOOK ??
          '../../../MBFD/Bid/2025 Bid Documents/eligible/2025 Bid position requirements and points.xlsx',
      );
      let fileData: Buffer;
      try {
        fileData = await fs.readFile(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT')
          throw new Error(
            'Requested local golden workbook is missing; no historical parsing was verified',
          );
        throw err;
      }
      const buf = fileData.buffer.slice(
        fileData.byteOffset,
        fileData.byteOffset + fileData.byteLength,
      ) as ArrayBuffer;
      const { createHash } = await import('node:crypto');
      expect(createHash('sha256').update(fileData).digest('hex')).toBe(
        '9cee1412fca281fbf09c0dde41a71c7618a9410fcc76edc0d956728d789926db',
      );
      const result = await parseLegacyWideMatrix(buf, { metadataColumns: 4 });
      expect(result.ok).toEqual([]);
      expect(result.errors[0]?.message).toContain('no qualification headers');
      // A format rejection is negative import coverage, not credential extraction
      // or approved eligibility/scoring/outcome replay evidence.
    },
  );
});
