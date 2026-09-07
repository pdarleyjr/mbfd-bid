import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseTargetSolutions } from '../src/lib/targetsolutions.js';

// Operator opt-in only. Never commit the personnel export or synthesize source evidence.
const path = process.env.TARGETSOLUTIONS_SOURCE_CSV;
it.skipIf(!path)(
  'parses the complete supplied September 2026 export with its actual coverage',
  () => {
    if (!path) throw new Error('Source path required');
    const bytes = readFileSync(path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '040b9dc94a738dc3c37c563b5fa351cc7738cdc80f8359278e5d5f78b547d135',
    );
    const report = parseTargetSolutions(new TextDecoder().decode(bytes));
    expect(report.errors).toEqual([]);
    expect(report.sourceRowCount).toBe(6892);
    expect(report.rows).toHaveLength(6892);
    expect(new Set(report.rows.map((r) => r.employeeId)).size).toBe(247);
    expect(new Set(report.rows.map((r) => r.credentialName)).size).toBe(215);
    expect(report.coverage).toMatchObject({
      activeOnly: true,
      expirationDates: false,
      issueDates: false,
      explicitStatus: false,
    });
    expect(report.observedOn).toBe('2026-09-07');
  },
);
