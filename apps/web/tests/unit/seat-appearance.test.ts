import { describe, expect, it } from 'vitest';
import {
  getForcedAssignmentLabel,
  getSeatAppearance,
} from '../../app/_components/bid/seat-appearance';

const appearance = (rankRequired: string, positionName: string, unit: string, division?: string) =>
  getSeatAppearance({ rankRequired, positionName, unit, division });

describe('seat role appearance', () => {
  it.each([
    ['CPT', 'Captain', 'Fire Boat 6', 'captain', '#fef08a'],
    ['LT', 'Lieutenant DE', 'Rescue Float', 'lieutenant', '#fca5a5'],
    ['FF', 'Firefighter DE #1', 'Combat Float', 'driver-engineer', '#bbf7d0'],
    ['FF', 'Firefighter #2', 'Ladder 1', 'engine-firefighter', '#e5e7eb'],
    ['FF', 'Firefighter #1', 'Rescue 2', 'rescue-firefighter', '#bae6fd'],
    ['FF', 'Firefighter ENG', 'Fire Boat 6', 'marine-firefighter', '#e6bb48'],
    ['FF', 'Inspector', 'Prevention', 'inspector', '#fdba74'],
    ['FF', 'Firefighter #1 INV', 'Combat 3', 'inspector', '#fdba74'],
  ])('colors %s / %s / %s by the requested seat role', (rank, name, unit, role, color) => {
    expect(appearance(rank, name, unit)).toMatchObject({ role, backgroundColor: color });
  });

  it('uses explicit seat rank before specialty words and marine before Driver Engineer', () => {
    expect(appearance('LT', 'Captain / Inspector', 'Marine')).toMatchObject({ role: 'lieutenant' });
    expect(appearance('CPT', 'Lieutenant DE', 'Marine')).toMatchObject({ role: 'captain' });
    expect(appearance('FF', 'Marine Firefighter DE', 'Engine 4')).toMatchObject({
      role: 'marine-firefighter',
    });
    expect(appearance('FF', 'Firefighter DE', 'Rescue 2')).toMatchObject({
      role: 'driver-engineer',
    });
  });

  it('uses a saved Rescue division for an ordinary firefighter and leaves a chief neutral', () => {
    expect(appearance('FF', 'Firefighter', 'Unit 2', 'Rescue').role).toBe('rescue-firefighter');
    expect(appearance('DC', 'Division Chief', '300').role).toBe('other');
    expect(appearance('DC', 'Division Chief', 'Marine').role).toBe('other');
  });

  it('keeps both regular and secondary text above 4.5:1 contrast on every palette', () => {
    const luminance = (hex: string) => {
      return (
        [
          [1, 0.2126],
          [3, 0.7152],
          [5, 0.0722],
        ] as const
      ).reduce((sum, [offset, weight]) => {
        const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return sum + linear * weight;
      }, 0);
    };
    for (const [rank, name, unit] of [
      ['CPT', 'Captain', 'Engine'],
      ['LT', 'Lieutenant', 'Engine'],
      ['FF', 'Firefighter DE', 'Engine'],
      ['FF', 'Firefighter', 'Ladder'],
      ['FF', 'Firefighter', 'Rescue'],
      ['FF', 'Firefighter', 'Marine'],
      ['FF', 'Inspector', 'Prevention'],
      ['DC', 'Chief', '300'],
    ] as const) {
      const palette = appearance(rank, name, unit);
      for (const text of [palette.color, palette.mutedColor]) {
        const a = luminance(palette.backgroundColor);
        const b = luminance(text);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('forced assignment provenance', () => {
  const forced = { commandId: 'canonical-force', actorMemberId: 99, atMs: 1, reason: '' };
  it('allows an optional empty note and includes a recorded note in accessible details', () => {
    expect(getForcedAssignmentLabel(forced)).toBe('Forced assignment');
    expect(getForcedAssignmentLabel({ ...forced, reason: 'Chief directed assignment' })).toBe(
      'Forced assignment: Chief directed assignment',
    );
  });
  it.each([
    undefined,
    null,
    true,
    {},
    { reason: 'Override' },
    { commandId: 'a-day-override', actorMemberId: 99, reason: 'Override', aDay: 'G4' },
    { ...forced, commandId: '' },
    { ...forced, atMs: Number.NaN },
  ])('does not infer forced provenance from %j', (value) => {
    expect(getForcedAssignmentLabel(value)).toBeNull();
  });
});
