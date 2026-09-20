import { describe, expect, it } from 'vitest';
import { ConfiguredScoringSchema } from '../../src/schemas/configured-scoring.js';

const criterion = (credential: string) => ({ credential, alternatives: [], requiresAll: [] });
const group = () => ({
  id: 'synthetic-cumulative',
  cap: null,
  items: [],
  preference: {
    mode: 'BINARY_CUMULATIVE',
    sourceRef: 'Synthetic reviewed source',
    criteria: [criterion('Course I')],
  },
});
const scoring = (groups: unknown[]) => ({ v: 1, total: groups, so: [], mo: [] });

describe('source-backed cumulative preference schema', () => {
  it('preserves historical numeric material without adding a discriminator or defaults', () => {
    const historical = scoring([
      { id: 'numeric', cap: 8, items: [{ ...criterion('Numeric'), points: 7 }] },
    ]);
    expect(ConfiguredScoringSchema.parse(historical)).toEqual(historical);
  });
  it('preserves a cumulative criterion with all prerequisites and no numeric weight', () => {
    const input = group();
    input.preference.criteria[0] = {
      credential: 'Course I',
      alternatives: [],
      requiresAll: ['Course II'],
    };
    expect(ConfiguredScoringSchema.parse(scoring([input]))).toEqual(scoring([input]));
  });
  it.each([
    { ...group(), cap: 1 },
    { ...group(), items: [{ ...criterion('Numeric'), points: 9 }] },
    { ...group(), preference: { ...group().preference, sourceRef: '' } },
    { ...group(), preference: { ...group().preference, criteria: [] } },
    {
      ...group(),
      preference: { ...group().preference, criteria: [{ ...criterion('Course I'), points: 99 }] },
    },
  ])('rejects capped, weighted, unsupported or unproven preference material %#', (input) => {
    expect(ConfiguredScoringSchema.safeParse(scoring([input])).success).toBe(false);
  });
  it('rejects duplicate credit across numeric and preference groups, including aliases', () => {
    const numeric = {
      id: 'numeric',
      cap: null,
      items: [{ credential: 'Numeric', alternatives: ['Course I'], requiresAll: [], points: 1 }],
    };
    expect(ConfiguredScoringSchema.safeParse(scoring([numeric, group()])).success).toBe(false);
  });
});

describe('ordered qualification preference schema', () => {
  it('preserves source-backed criterion order without numeric tier weights', () => {
    const value = {
      ...scoring([]),
      orderedPreference: {
        mode: 'ORDERED_QUALIFICATIONS',
        sourceRef: 'PDF p2 Procedure3(e)',
        criteria: [criterion('IAAI-CFI'), criterion('Next source criterion')],
      },
    };
    expect(ConfiguredScoringSchema.parse(value)).toEqual(value);
    expect(JSON.stringify(value)).not.toContain('points');
  });
  it.each([
    { mode: 'ORDERED_QUALIFICATIONS', sourceRef: '', criteria: [criterion('IAAI-CFI')] },
    { mode: 'ORDERED_QUALIFICATIONS', sourceRef: 'Synthetic source', criteria: [] },
    {
      mode: 'ORDERED_QUALIFICATIONS',
      sourceRef: 'Synthetic source',
      criteria: [{ ...criterion('IAAI-CFI'), points: 999 }],
    },
  ])('rejects unproven, empty, or weighted ordinal material %#', (orderedPreference) => {
    expect(ConfiguredScoringSchema.safeParse({ ...scoring([]), orderedPreference }).success).toBe(
      false,
    );
  });
});
