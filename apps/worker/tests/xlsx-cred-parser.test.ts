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

  it('dedupes credential names (case-insensitive trim)', async () => {
    const buf = await toArrayBuffer([
      ['Emp Id', 'Driver Engineer Qualified', ' driver engineer qualified ', 'Acting Lt'],
      ['14335', 4, 4, 6],
    ]);
    const result = await parseLegacyWideMatrix(buf, { metadataColumns: 1 });
    expect(result.ok).toHaveLength(2);
  });
});

describe('parseLegacyWideMatrix golden', () => {
  it.skipIf(!process.env.LOCAL_GOLDEN_TESTS)(
    'extracts >= 30 credential names from the 2025 wide-matrix xlsx',
    async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const file = path.resolve(
        '../../../MBFD/Bid/2025 Bid Documents/eligible/2025 Bid position requirements and points.xlsx',
      );
      let fileData: Buffer;
      try {
        fileData = await fs.readFile(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      const buf = fileData.buffer.slice(
        fileData.byteOffset,
        fileData.byteOffset + fileData.byteLength,
      ) as ArrayBuffer;
      const result = await parseLegacyWideMatrix(buf, { metadataColumns: 4 });
      expect(result.ok.length).toBeGreaterThanOrEqual(30);
    },
  );
});
