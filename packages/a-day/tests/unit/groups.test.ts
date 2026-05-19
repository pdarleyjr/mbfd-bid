import { describe, expect, it } from 'vitest';
import {
  COMBAT_GROUPS,
  DEFAULT_GROUP_CAPACITY,
  OFFICER_RANKS,
  WEEKDAYS,
  isCombatGroup,
  isOfficer,
  isValidADayForShift,
  isWeekday,
} from '../../src/groups.js';

describe('COMBAT_GROUPS', () => {
  it('is exactly G1, G2, G3, G4 in order', () => {
    expect(COMBAT_GROUPS).toEqual(['G1', 'G2', 'G3', 'G4']);
  });
});

describe('WEEKDAYS', () => {
  it('is exactly MON..SUN in ISO order', () => {
    expect(WEEKDAYS).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  });
});

describe('OFFICER_RANKS', () => {
  it('contains DC, CPT, LT only', () => {
    expect(new Set(OFFICER_RANKS)).toEqual(new Set(['DC', 'CPT', 'LT']));
    expect(OFFICER_RANKS).toHaveLength(3);
  });
});

describe('isOfficer', () => {
  it('true for DC, CPT, LT', () => {
    expect(isOfficer('DC')).toBe(true);
    expect(isOfficer('CPT')).toBe(true);
    expect(isOfficer('LT')).toBe(true);
  });

  it('false for FF', () => {
    expect(isOfficer('FF')).toBe(false);
  });

  it('false for excluded ranks DEP_CHIEF, CHIEF (they do not bid)', () => {
    expect(isOfficer('DEP_CHIEF')).toBe(false);
    expect(isOfficer('CHIEF')).toBe(false);
  });
});

describe('isCombatGroup', () => {
  it('true for G1-G4', () => {
    for (const g of ['G1', 'G2', 'G3', 'G4']) {
      expect(isCombatGroup(g)).toBe(true);
    }
  });

  it('false for weekdays and unknown', () => {
    expect(isCombatGroup('MON')).toBe(false);
    expect(isCombatGroup('G5')).toBe(false);
    expect(isCombatGroup('')).toBe(false);
  });
});

describe('isWeekday', () => {
  it('true for MON..SUN', () => {
    for (const d of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
      expect(isWeekday(d)).toBe(true);
    }
  });

  it('false for groups and unknown', () => {
    expect(isWeekday('G1')).toBe(false);
    expect(isWeekday('FUN')).toBe(false);
  });
});

describe('isValidADayForShift', () => {
  it('A/B/C shift accepts only group ids', () => {
    expect(isValidADayForShift('A', 'G1')).toBe(true);
    expect(isValidADayForShift('B', 'G3')).toBe(true);
    expect(isValidADayForShift('C', 'G4')).toBe(true);
    expect(isValidADayForShift('A', 'MON')).toBe(false);
  });

  it('D shift accepts only weekdays', () => {
    expect(isValidADayForShift('D', 'MON')).toBe(true);
    expect(isValidADayForShift('D', 'FRI')).toBe(true);
    expect(isValidADayForShift('D', 'G1')).toBe(false);
  });
});

describe('DEFAULT_GROUP_CAPACITY', () => {
  it('has min=18, max=19, officersRequired=5', () => {
    expect(DEFAULT_GROUP_CAPACITY).toEqual({
      min: 18,
      max: 19,
      officersRequired: 5,
    });
  });
});
