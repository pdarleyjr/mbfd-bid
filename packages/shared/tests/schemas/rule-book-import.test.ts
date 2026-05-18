import { describe, expect, it } from 'vitest';
import { RuleBookEntrySchema } from '../../src/schemas/rule-book-import';

const BASE_ENTRY = {
  positionId: 'A101',
  templateVersion: '2025.1',
  ruleBookVersion: '2025',
  requiredCriteria: {
    credentials: ['Driver Engineer Qualified'],
    rank: ['LT', 'CPT'],
    custom: [],
  },
  pointsPreference: {
    max: 20,
    items: [
      { points: 4, credential: 'Driver Engineer Qualified' },
      { points: 2, credential: 'Hazmat Operations', gating: 'shift' },
    ],
  },
  tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
  notes: 'Ladder company requires DE cert.',
};

describe('RuleBookEntrySchema', () => {
  it('happy path: all fields populated parse successfully', () => {
    const result = RuleBookEntrySchema.safeParse(BASE_ENTRY);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.positionId).toBe('A101');
      expect(result.data.templateVersion).toBe('2025.1');
      expect(result.data.pointsPreference.max).toBe(20);
      expect(result.data.requiredCriteria.rank).toEqual(['LT', 'CPT']);
    }
  });

  it('defaults tieBreakChain to ["points", "rsc_seniority", "rank_seniority"] when omitted', () => {
    const { tieBreakChain: _removed, ...rest } = BASE_ENTRY;
    const result = RuleBookEntrySchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tieBreakChain).toEqual(['points', 'rsc_seniority', 'rank_seniority']);
    }
  });

  it('rejects negative pointsPreference.max', () => {
    const result = RuleBookEntrySchema.safeParse({
      ...BASE_ENTRY,
      pointsPreference: {
        ...BASE_ENTRY.pointsPreference,
        max: -1,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty positionId', () => {
    const result = RuleBookEntrySchema.safeParse({
      ...BASE_ENTRY,
      positionId: '',
    });
    expect(result.success).toBe(false);
  });

  it('defaults requiredCriteria arrays to empty when omitted', () => {
    const result = RuleBookEntrySchema.safeParse({
      ...BASE_ENTRY,
      requiredCriteria: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredCriteria.credentials).toEqual([]);
      expect(result.data.requiredCriteria.rank).toEqual([]);
      expect(result.data.requiredCriteria.custom).toEqual([]);
    }
  });

  it('rejects invalid rank in requiredCriteria.rank array', () => {
    const result = RuleBookEntrySchema.safeParse({
      ...BASE_ENTRY,
      requiredCriteria: {
        ...BASE_ENTRY.requiredCriteria,
        rank: ['ENSIGN'],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional notes as null', () => {
    const result = RuleBookEntrySchema.safeParse({
      ...BASE_ENTRY,
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing optional notes', () => {
    const { notes: _removed, ...rest } = BASE_ENTRY;
    const result = RuleBookEntrySchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it('passes through unknown fields in requiredCriteria (passthrough)', () => {
    const result = RuleBookEntrySchema.safeParse({
      ...BASE_ENTRY,
      requiredCriteria: {
        ...BASE_ENTRY.requiredCriteria,
        future_criteria: 'something',
      },
    });
    expect(result.success).toBe(true);
  });
});
