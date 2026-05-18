import { describe, expect, it } from 'vitest';
import { MO_CREDENTIAL_NAMES, computeMoPoints } from '../../src/points/mo-pool.js';
import type { Member } from '../../src/types.js';

const member = (credNames: string[]): Member => ({
  employeeId: '1',
  firstName: 'A',
  lastName: 'B',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary: false,
  credentials: credNames.map((name) => ({ name })),
});

describe('MO sub-pool', () => {
  it('MO_CREDENTIAL_NAMES includes MMC, IADRS, Open Water Diver, PSD, Hazmat, Car Seat', () => {
    expect(MO_CREDENTIAL_NAMES).toContain('Merchant Mariner Credential (MMC)');
    expect(MO_CREDENTIAL_NAMES).toContain('IADRS Swim Evaluation');
    expect(MO_CREDENTIAL_NAMES).toContain('Open Water Diver Certified');
    expect(MO_CREDENTIAL_NAMES).toContain('Certified Public Safety Diver');
    expect(MO_CREDENTIAL_NAMES).toContain('Hazardous Materials Operations');
    expect(MO_CREDENTIAL_NAMES).toContain('Car Seat Technician');
  });

  it('member with all MO creds scores 6', () => {
    const score = computeMoPoints(member([...MO_CREDENTIAL_NAMES]));
    expect(score).toBe(6);
  });

  it('member with MMC + IADRS scores 2', () => {
    expect(
      computeMoPoints(member(['Merchant Mariner Credential (MMC)', 'IADRS Swim Evaluation'])),
    ).toBe(2);
  });

  it('Hazmat Awareness Level substitutes for Hazardous Materials Operations', () => {
    const score = computeMoPoints(member(['Hazmat Awareness Level']));
    expect(score).toBe(1);
  });

  it('member with no MO creds scores 0', () => {
    expect(computeMoPoints(member([]))).toBe(0);
  });
});
