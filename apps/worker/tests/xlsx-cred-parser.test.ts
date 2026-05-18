import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseCredentialsXlsx, parseLegacyWideMatrix } from '../src/lib/xlsx-cred-parser.js';

function buildXlsx(rows: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('parseCredentialsXlsx (normalized)', () => {
  it('parses a clean normalized workbook', () => {
    const buf = buildXlsx([
      { name: 'Driver Engineer Qualified', fy_points_default: 4 },
      { name: 'Hazmat Tech', fy_points_default: 6 },
      { name: 'Acting Lt', fy_points_default: 0 },
    ]);
    const result = parseCredentialsXlsx(buf);
    expect(result.ok).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.ok[0]?.name).toBe('Driver Engineer Qualified');
    expect(result.ok[0]?.fyPointsDefault).toBe(4);
  });

  it('rejects empty name', () => {
    const buf = buildXlsx([{ name: '', fy_points_default: 1 }]);
    const result = parseCredentialsXlsx(buf);
    expect(result.ok).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('defaults fy_points_default to 0 when missing', () => {
    const buf = buildXlsx([{ name: 'Hazmat Awareness' }]);
    const result = parseCredentialsXlsx(buf);
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.fyPointsDefault).toBe(0);
  });
});

describe('parseLegacyWideMatrix', () => {
  it('extracts credential names from header row of wide-matrix sheet', () => {
    // Synthetic wide-matrix shape: row 1 = headers; first few cols are metadata
    const ws = XLSX.utils.aoa_to_sheet([
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
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const result = parseLegacyWideMatrix(buf, { metadataColumns: 3 });
    expect(result.ok).toHaveLength(3);
    expect(result.ok.map((c) => c.name)).toEqual([
      'Driver Engineer Qualified',
      'Hazmat Tech',
      'Acting Lt',
    ]);
    expect(result.ok.every((c) => c.fyPointsDefault === 0)).toBe(true);
  });

  it('dedupes credential names (case-insensitive trim)', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Emp Id', 'Driver Engineer Qualified', ' driver engineer qualified ', 'Acting Lt'],
      ['14335', 4, 4, 6],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const result = parseLegacyWideMatrix(buf, { metadataColumns: 1 });
    expect(result.ok).toHaveLength(2); // dedupe
  });
});

// Golden test against the real 2025 xlsx. Skip if file unavailable.
describe('parseLegacyWideMatrix golden', () => {
  it.skipIf(!process.env.LOCAL_GOLDEN_TESTS)(
    'extracts >= 30 credential names from the 2025 wide-matrix xlsx',
    async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const file = path.resolve(
        '../../../MBFD/Bid/2025 Bid Documents/eligible/2025 Bid position requirements and points.xlsx',
      );
      // Read directly and silently skip when the local source file is
      // unavailable (CI doesn't have the local MBFD checkout). Avoids the
      // access-then-read TOCTOU pattern (CodeQL js/file-system-race).
      let fileData: Buffer;
      try {
        fileData = await fs.readFile(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      const buf = fileData.buffer as ArrayBuffer;
      const result = parseLegacyWideMatrix(buf, { metadataColumns: 4 });
      expect(result.ok.length).toBeGreaterThanOrEqual(30);
    },
  );
});
