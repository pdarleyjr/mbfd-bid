import { describe, expect, it } from 'vitest';
import {
  type EligibilityExportList,
  generateEligibilityPdf,
  generateEligibilityWorkbook,
} from '../../src/exports/eligibility-lists.js';

const list: EligibilityExportList = {
  positionId: 'A611',
  ruleBookVersion: '2026.3',
  asOf: '2026-09-24',
  eligible: [
    {
      member: { employeeId: '100', firstName: 'Test', lastName: 'Member', rank: 'CPT' },
      result: { points: 1, reasons: [{ label: 'Holds current required', satisfied: true }] },
      priority: 1,
      orderingComponents: { points: 1, time_in_grade_bid_ordinal: 2 },
      dataBlockers: [],
    },
  ],
  excluded: [],
  dataBlocked: [],
};

describe('eligibility list exports', () => {
  it('creates a real XLSX ZIP container', async () => {
    const bytes = new Uint8Array(await (await generateEligibilityWorkbook([list])).arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes.length).toBeGreaterThan(2_000);
  });

  it('creates a parseable PDF envelope with policy metadata', () => {
    const bytes = generateEligibilityPdf([list]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Position A611');
    expect(text).toContain('Rule book 2026.3');
    expect(text.endsWith('%%EOF')).toBe(true);
  });
});
