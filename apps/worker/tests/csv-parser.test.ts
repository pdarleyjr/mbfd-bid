import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseCsv } from '../src/lib/csv-parser.js';

const SimpleSchema = z
  .object({
    name: z.string(),
    count: z.coerce.number(),
  })
  .transform((r) => ({ name: r.name, count: r.count }));

describe('parseCsv', () => {
  it('returns ok rows and per-row errors', async () => {
    const csv = `name,count
alice,3
bob,not-a-number
carol,7`;
    const result = await parseCsv(csv, SimpleSchema);
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.rowNumber).toBe(3); // header is row 1, "alice" is row 2, "bob" is row 3
  });

  it('normalizes headers (whitespace -> underscore, lowercased)', async () => {
    const csv = `Employee Id,Last Name
14335,Sola`;
    const Schema = z.object({ employee_id: z.string(), last_name: z.string() });
    const result = await parseCsv(csv, Schema);
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.employee_id).toBe('14335');
  });

  it('handles BOM at start of file', async () => {
    const csv = `﻿name,count
alice,3`;
    const result = await parseCsv(csv, SimpleSchema);
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.name).toBe('alice');
  });

  it('skips empty lines', async () => {
    const csv = `name,count
alice,3

bob,5
`;
    const result = await parseCsv(csv, SimpleSchema);
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('golden: parses 2025 personnel.csv with the real MemberImportRowSchema (>= 200 ok rows)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.resolve('../../../MBFD_Hub/analysis/personnel.csv');

    // Skip if file is not accessible (e.g. CI environment)
    try {
      await fs.access(file);
    } catch {
      // File not accessible - skip this test in CI
      return;
    }

    const csv = await fs.readFile(file, 'utf-8');
    const { MemberImportRowSchema } = await import('@mbfd/shared');
    const result = await parseCsv(csv, MemberImportRowSchema);
    expect(result.ok.length).toBeGreaterThanOrEqual(200);
    // We expect a handful of errors (excluded rows with empty bid_category etc.) - keep loose
    expect(result.errors.length).toBeLessThan(40);
  });
});
