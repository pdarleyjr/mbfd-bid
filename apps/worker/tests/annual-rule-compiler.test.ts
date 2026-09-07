import { type AnnualRuleProfile, AnnualRuleProfilesSchema } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { compileAnnualRules } from '../src/lib/annual-rule-compiler.js';
const positions = [{ id: 'A-1', rank: 'FF' as const, station: '1', shift: 'A' }];
const base: AnnualRuleProfile = {
  id: 'department',
  name: 'Synthetic department',
  sourceRef: 'synthetic-only',
  scope: { kind: 'department' },
  requirements: { credentials: [], custom: [] },
  scoring: { v: 1, total: [], so: [], mo: [] },
  tieBreakChain: ['rsc_seniority'],
};
describe('annual profile compiler', () => {
  it('combines prerequisites and resolves explicit scoped scoring with provenance', () => {
    const rank: AnnualRuleProfile = {
      ...base,
      id: 'rank',
      scope: { kind: 'rank', rank: 'FF' },
      requirements: { credentials: ['Prerequisite'], custom: ['non_probationary'] },
      scoring: {
        v: 1,
        total: [
          {
            id: 'training',
            cap: 2,
            items: [
              {
                credential: 'Training',
                alternatives: [],
                requiresAll: ['Prerequisite'],
                points: 3,
              },
            ],
          },
        ],
        so: [],
        mo: [],
      },
    };
    const position: AnnualRuleProfile = {
      ...base,
      id: 'position',
      scope: { kind: 'position', positionId: 'A-1' },
      requirements: { credentials: ['Safety'], custom: [] },
      scoring: undefined,
      tieBreakChain: ['points', 'rsc_seniority'],
    };
    const result = compileAnnualRules(positions, [position, base, rank], '2027.1');
    expect(result.ok).toBe(true);
    expect(result.compiled[0]).toMatchObject({
      rule: {
        requiredCriteria: { credentials: ['Prerequisite', 'Safety'], custom: ['non_probationary'] },
        pointsPreference: { scoring: rank.scoring },
        tieBreakChain: position.tieBreakChain,
      },
      provenance: {
        scoring: ['rank'],
        priorities: ['position'],
        matched: ['department', 'rank', 'position'],
      },
    });
  });
  it('rejects overlapping families, excluded ranks, unknown targets and missing definitions', () => {
    const family: AnnualRuleProfile = {
      ...base,
      id: 'family1',
      scope: { kind: 'family', name: 'Specialty', positionIds: ['A-1'] },
    };
    const overlap: AnnualRuleProfile = { ...family, id: 'family2', tieBreakChain: ['points'] };
    expect(
      compileAnnualRules(positions, [base, family, overlap], '2027.1').conflicts,
    ).toContainEqual(
      expect.objectContaining({ field: 'tieBreakChain', profileIds: ['family1', 'family2'] }),
    );
    expect(
      compileAnnualRules(
        positions,
        [{ ...base, requirements: { ranks: ['CPT'], credentials: [], custom: [] } }],
        '2027.1',
      ).ok,
    ).toBe(false);
    expect(
      compileAnnualRules(
        positions,
        [{ ...family, scope: { kind: 'position', positionId: 'other' } }],
        '2027.1',
      ).ok,
    ).toBe(false);
    expect(compileAnnualRules(positions, [], '2027.1').ok).toBe(false);
    expect(
      AnnualRuleProfilesSchema.safeParse([base, { ...base, name: 'Duplicate identity' }]).success,
    ).toBe(false);
  });
  it('keeps compilation deterministic under profile input reordering', () => {
    const secondary: AnnualRuleProfile = {
      ...base,
      id: 'specific',
      scope: { kind: 'station_shift', station: '1', shift: 'A' },
      requirements: { credentials: ['Z', 'A'], custom: [] },
    };
    expect(compileAnnualRules(positions, [base, secondary], '2027.1')).toEqual(
      compileAnnualRules(positions, [secondary, base], '2027.1'),
    );
  });
});
