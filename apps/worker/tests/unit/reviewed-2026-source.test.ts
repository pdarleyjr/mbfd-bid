import { describe, expect, it } from 'vitest';
import { buildReviewed2026Source } from '../../src/lib/reviewed-2026-source.js';

describe('final 2026 reviewed source', () => {
  it('uses the exact 228-profile MASTER topology and 223 active opportunities', () => {
    const source = buildReviewed2026Source();
    expect(source.positions).toHaveLength(228);
    expect(source.rules).toHaveLength(223);
    expect(
      Object.fromEntries(
        ['A', 'B', 'C', 'D'].map((shift) => [
          shift,
          source.positions.filter((position) => position.shift === shift).length,
        ]),
      ),
    ).toEqual({ A: 74, B: 73, C: 73, D: 8 });
    expect(source.administrativePositionIds).toEqual(['A801', 'D201', 'D301', 'D401', 'D402']);
    expect(source.rules.map((rule) => rule.positionId)).not.toEqual(
      expect.arrayContaining(['A801', 'D201', 'D301', 'D401', 'D402']),
    );
  });

  it.each(['B214', 'C214'])('%s uses Combat at runtime and preserves the raw discrepancy', (id) => {
    const position = buildReviewed2026Source().positions.find((candidate) => candidate.id === id);
    expect(position).toMatchObject({
      division: 'Combat',
      source: {
        sourceDivision: 'Rescue',
        correction:
          '2026-09-24 administrative decision: runtime Division is Combat; raw MASTER label retained',
      },
    });
  });
});
