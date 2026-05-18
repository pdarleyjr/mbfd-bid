import { describe, expect, it } from 'vitest';
import { MemberImportRowSchema } from '../../src/schemas/member-import';

const BASE_ROW = {
  employee_id: '20731',
  last_name: 'Smith',
  first_name: 'John',
  current_rank: 'Division Chief',
  bid_rank: 'Division Chief',
  bid_category: 'OFC',
  bid: 'Include',
  rsc_seniority: '15',
  hired_at: '10/18/1993',
  promoted_at: null,
};

describe('MemberImportRowSchema', () => {
  it('happy path: Division Chief OFC → bidCategory OFC, rank DC', () => {
    const result = MemberImportRowSchema.safeParse(BASE_ROW);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBe('DC');
      expect(result.data.bidCategory).toBe('OFC');
      expect(result.data.employeeId).toBe('20731');
      expect(result.data.rscSeniority).toBe(15);
    }
  });

  it('happy path: Firefighter Include FF → bidCategory FF, rank FF', () => {
    const result = MemberImportRowSchema.safeParse({
      ...BASE_ROW,
      current_rank: 'Firefighter',
      bid_rank: 'Firefighter',
      bid_category: 'FF',
      bid: 'Include',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBe('FF');
      expect(result.data.bidCategory).toBe('FF');
    }
  });

  it('Exclude bid → bidCategory EXCLUDED regardless of bid_category value', () => {
    const result = MemberImportRowSchema.safeParse({
      ...BASE_ROW,
      bid_category: 'OFC',
      bid: 'Exclude',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bidCategory).toBe('EXCLUDED');
    }
  });

  it('unknown rank → safeParse returns success false', () => {
    const result = MemberImportRowSchema.safeParse({
      ...BASE_ROW,
      current_rank: 'Ensign',
    });
    expect(result.success).toBe(false);
  });

  it('transforms numeric rsc_seniority (number input) correctly', () => {
    const result = MemberImportRowSchema.safeParse({
      ...BASE_ROW,
      rsc_seniority: 22,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rscSeniority).toBe(22);
    }
  });

  it('passes through unknown fields (passthrough)', () => {
    const result = MemberImportRowSchema.safeParse({
      ...BASE_ROW,
      extra_column: 'future_data',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing employee_id', () => {
    const { employee_id: _removed, ...rest } = BASE_ROW;
    const result = MemberImportRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid bid value', () => {
    const result = MemberImportRowSchema.safeParse({
      ...BASE_ROW,
      bid: 'Maybe',
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from name fields', () => {
    const result = MemberImportRowSchema.safeParse({
      ...BASE_ROW,
      first_name: '  Jane  ',
      last_name: '  Doe  ',
      employee_id: '  99999  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe('Jane');
      expect(result.data.lastName).toBe('Doe');
      expect(result.data.employeeId).toBe('99999');
    }
  });

  it('all 6 rank labels map correctly', () => {
    const cases: Array<[string, string]> = [
      ['Firefighter', 'FF'],
      ['Lieutenant', 'LT'],
      ['Captain', 'CPT'],
      ['Division Chief', 'DC'],
      ['Deputy Fire Chief', 'DEP_CHIEF'],
      ['Fire Chief', 'CHIEF'],
    ];
    for (const [label, expected] of cases) {
      const result = MemberImportRowSchema.safeParse({
        ...BASE_ROW,
        current_rank: label,
        bid_category: '0',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rank).toBe(expected);
      }
    }
  });
});
