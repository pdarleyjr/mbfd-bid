import { describe, expect, it } from 'vitest';
import { correctedMarineRule } from '../../src/routes/admin/positions.js';

describe('final July 2026 persisted Marine rules', () => {
  const cases = [
    ['A611', 'CPT', 'Metal Craft Officer Credential', false, false],
    ['A612', 'FF', 'Metal Craft Boat Operator Credential', true, true],
    ['A613', 'FF', 'Metal Craft Engineer Credential', true, true],
    ['A614', 'FF', 'Metal Craft Deckhand Credential', false, true],
    ['A615', 'FF', 'Metal Craft Deckhand Credential', false, true],
    ['A616', 'FF', 'Metal Craft Deckhand Credential', false, true],
  ] as const;

  it.each(cases)(
    '%s keeps minimums separate from preferences',
    (positionId, rank, craft, needsDe, carSeat) => {
      const encoded = correctedMarineRule(positionId);
      const required = JSON.parse(encoded.requiredCriteria) as {
        rank: string[];
        credentials: string[];
        postAward: unknown[];
      };
      const preferences = JSON.parse(encoded.pointsPreference) as {
        max: number;
        items: { credential: string; points: number }[];
      };
      expect(required.rank).toEqual([rank]);
      expect(required.credentials).toContain(craft);
      expect(required.credentials).toContain('Hazardous Materials Awareness');
      expect(required.credentials).not.toContain('Hazardous Materials Operations');
      expect(required.credentials.includes('Driver Engineer Qualified')).toBe(needsDe);
      expect(preferences.items.map((item) => item.credential)).toEqual(
        carSeat ? ['Public Safety Diver', 'Car Seat Technician'] : ['Public Safety Diver'],
      );
      expect(preferences.max).toBe(carSeat ? 2 : 1);
      expect(required.postAward).toHaveLength(1);
    },
  );
});
