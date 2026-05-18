import { describe, expect, it } from 'vitest';
import { driverEngineerSatisfied } from '../../src/criteria/driver-engineer.js';
import type { Member } from '../../src/types.js';

const withCreds = (names: string[]): Member => ({
  employeeId: '1',
  firstName: 'A',
  lastName: 'B',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary: false,
  credentials: names.map((name) => ({ name })),
});

describe('driverEngineerSatisfied', () => {
  it('holds Driver Engineer Qualified credential — satisfied', () => {
    expect(driverEngineerSatisfied(withCreds(['Driver Engineer Qualified'])).satisfied).toBe(true);
  });

  it('holds Fire Apparatus Ops + Fire Service Hydraulics — satisfied (dual-path)', () => {
    expect(
      driverEngineerSatisfied(
        withCreds(['Fire Apparatus Operations (FFP-1302)', 'Fire Service Hydraulics (FFP1301)']),
      ).satisfied,
    ).toBe(true);
  });

  it('holds FL Pump Operator — satisfied (single-path)', () => {
    expect(driverEngineerSatisfied(withCreds(['Florida Pump Operator'])).satisfied).toBe(true);
  });

  it('holds only Fire Apparatus Ops (missing Hydraulics) — not satisfied', () => {
    expect(
      driverEngineerSatisfied(withCreds(['Fire Apparatus Operations (FFP-1302)'])).satisfied,
    ).toBe(false);
  });

  it('holds nothing — not satisfied', () => {
    expect(driverEngineerSatisfied(withCreds([])).satisfied).toBe(false);
  });
});
