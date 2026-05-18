import { describe, expect, it } from 'vitest';
import { PositionRowSchema } from '../../src/schemas/position-import';

const BASE_POSITION = {
  number: 'A101',
  shift: 'A Shift',
  station: 'Station #1',
  division: 'Combat',
  unit: 'Ladder 1',
  rank: 'Captain',
  position: '1',
  assignment: '',
  enabled: 'Yes',
};

describe('PositionRowSchema', () => {
  it('happy path: normalizes station, shift, and rank', () => {
    const result = PositionRowSchema.safeParse(BASE_POSITION);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shift).toBe('A');
      expect(result.data.station).toBe('1');
      expect(result.data.rankRequired).toBe('CPT');
      expect(result.data.id).toBe('A101');
    }
  });

  it('Float station → isFloating true, station stays "Float"', () => {
    const result = PositionRowSchema.safeParse({
      ...BASE_POSITION,
      number: 'A800',
      station: 'Float',
      division: 'Rescue',
      unit: 'Float Rescue',
      rank: 'Firefighter',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isFloating).toBe(true);
      expect(result.data.station).toBe('Float');
      expect(result.data.rankRequired).toBe('FF');
    }
  });

  it('unknown rank → safeParse returns success false', () => {
    const result = PositionRowSchema.safeParse({
      ...BASE_POSITION,
      rank: 'Ensign',
    });
    expect(result.success).toBe(false);
  });

  it('bad shift format → safeParse returns success false', () => {
    const result = PositionRowSchema.safeParse({
      ...BASE_POSITION,
      shift: 'Night Shift',
    });
    expect(result.success).toBe(false);
  });

  it('all rank variants normalize correctly', () => {
    const cases: Array<[string, string]> = [
      ['Firefighter', 'FF'],
      ['Firefighter DE', 'FF'],
      ['Firefighter #1', 'FF'],
      ['Firefighter #2', 'FF'],
      ['Firefighter #3', 'FF'],
      ['Lieutenant', 'LT'],
      ['Captain', 'CPT'],
      ['Division Chief', 'DC'],
    ];
    for (const [rankLabel, expected] of cases) {
      const result = PositionRowSchema.safeParse({
        ...BASE_POSITION,
        rank: rankLabel,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rankRequired).toBe(expected);
      }
    }
  });

  it('all shift labels A-D parse correctly', () => {
    for (const shift of ['A', 'B', 'C', 'D']) {
      const result = PositionRowSchema.safeParse({
        ...BASE_POSITION,
        shift: `${shift} Shift`,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shift).toBe(shift);
      }
    }
  });

  it('passes through unknown fields (passthrough)', () => {
    const result = PositionRowSchema.safeParse({
      ...BASE_POSITION,
      future_col: 'data',
    });
    expect(result.success).toBe(true);
  });

  it('sets isVacantByDesign and isExcludedFromCount to false by default', () => {
    const result = PositionRowSchema.safeParse(BASE_POSITION);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isVacantByDesign).toBe(false);
      expect(result.data.isExcludedFromCount).toBe(false);
    }
  });

  it('station with text "Float" in name → isFloating true', () => {
    const result = PositionRowSchema.safeParse({
      ...BASE_POSITION,
      station: 'Float Station',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isFloating).toBe(true);
    }
  });
});
