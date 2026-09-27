import { describe, expect, it } from 'vitest';
import { buildCorrected2026DraftRules } from '../../src/lib/corrected-2026-draft-rules.js';

const candidate = buildCorrected2026DraftRules();
const rule = (id: string) => {
  const found = candidate.rules.find((item) => item.positionId === id);
  if (!found) throw new Error(`Missing candidate rule ${id}`);
  return found;
};

describe('corrected 2026 draft rules from semantic roles', () => {
  it('covers exactly the 223 current Bid opportunities and excludes all Chiefs', () => {
    expect(candidate.status).toBe('DRAFT_BLOCKED_NOT_FOR_PRODUCTION');
    expect(candidate.blockingIssues.length).toBeGreaterThan(0);
    expect(candidate.rules).toHaveLength(223);
    expect(new Set(candidate.rules.map((item) => item.positionId)).size).toBe(223);
    for (const id of ['A211', 'B211', 'C211', 'A801', 'D201', 'D301', 'D401', 'D402']) {
      expect(candidate.rules.map((item) => item.positionId)).not.toContain(id);
    }
  });

  it('creates independent CPT Float rules while retaining Rescue LT and Combat FF ranks', () => {
    for (const shift of ['A', 'B', 'C']) {
      expect(rule(`${shift}718`).requiredCriteria).toMatchObject({
        rank: ['CPT'],
        credentials: [],
      });
      expect(rule(`${shift}213`).requiredCriteria.rank).toEqual(['LT']);
      expect(rule(`${shift}214`).requiredCriteria.rank).toEqual(['FF']);
      expect(rule(`${shift}707`).requiredCriteria.credentials).toContain(
        'Driver Engineer Qualified',
      );
    }
  });

  it('maps Investigator, Captain 5, Air Tech and Marine requirements by current roles', () => {
    for (const shift of ['A', 'B', 'C']) {
      expect(rule(`${shift}305`).requiredCriteria.credentials).toEqual([
        'Fire Investigator (FL cert issued 2015 or later)',
        'Firesafety Inspector I',
      ]);
      expect(
        rule(`${shift}305`).pointsPreference.scoring?.orderedPreference?.criteria[0]?.credential,
      ).toBe('Certified Fire Investigator (IAAI-CFI)');
      expect(rule(`${shift}303`).requiredCriteria.credentials).toEqual([
        'Driver Engineer Qualified',
      ]);
      expect(rule(`${shift}212`).requiredCriteria).toMatchObject({
        rank: ['CPT'],
        custom: ['paramedic'],
        service: [{ serviceCode: 'RESCUE_DIVISION', minimumMonths: 36 }],
      });
      expect(rule(`${shift}212`).requiredCriteria.postAward).toBeUndefined();
      expect(rule(`${shift}203`).requiredCriteria.credentials).toEqual([
        'Driver Engineer Qualified',
        'SCOTT SCBA Technician',
        'Cylinder Hazmat & FSO Compliance (AIR TECH REQUIREMENT)',
      ]);
      expect(rule(`${shift}601`).requiredCriteria.rank).toEqual(['CPT']);
      expect(rule(`${shift}602`).requiredCriteria.credentials).toContain(
        'Metal Craft Boat Operator Credential',
      );
      expect(rule(`${shift}603`).requiredCriteria.credentials).toContain(
        'Metal Craft Engineer Credential',
      );
      for (const suffix of ['604', '605', '606'])
        expect(rule(`${shift}${suffix}`).requiredCriteria.credentials).toContain(
          'Metal Craft Deckhand Credential',
        );
    }
  });
});
