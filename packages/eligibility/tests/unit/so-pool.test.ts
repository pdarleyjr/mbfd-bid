import { describe, expect, it } from 'vitest';
import { SO_CREDENTIAL_NAMES, computeSoPoints } from '../../src/points/so-pool.js';
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

describe('SO sub-pool', () => {
  it('SO_CREDENTIAL_NAMES includes all 6 Ops certs', () => {
    expect(SO_CREDENTIAL_NAMES).toContain('Hazardous Materials Operations');
    expect(SO_CREDENTIAL_NAMES).toContain('Rope Rescue Operations');
    expect(SO_CREDENTIAL_NAMES).toContain('Confined Space Operations');
    expect(SO_CREDENTIAL_NAMES).toContain('Structural Collapse Operations');
    expect(SO_CREDENTIAL_NAMES).toContain('Trench Rescue Operations');
    expect(SO_CREDENTIAL_NAMES).toContain('Vehicle & Machinery Rescue Operations');
  });

  it('SO_CREDENTIAL_NAMES includes all 6 Tech certs', () => {
    expect(SO_CREDENTIAL_NAMES).toContain('State Certified Hazardous Materials Technician');
    expect(SO_CREDENTIAL_NAMES).toContain('Rope Rescue Technician');
    expect(SO_CREDENTIAL_NAMES).toContain('Confined Space Technician');
    expect(SO_CREDENTIAL_NAMES).toContain('Structural Collapse Technician');
    expect(SO_CREDENTIAL_NAMES).toContain('Trench Rescue Technician');
    expect(SO_CREDENTIAL_NAMES).toContain('Vehicle & Machinery Rescue Technician');
  });

  it('SO_CREDENTIAL_NAMES includes Drone Operator', () => {
    expect(SO_CREDENTIAL_NAMES).toContain('Drone Operator Qualified-Part 107 sUAS');
  });

  it('member with all 6 ops + all 6 tech + drone scores 13', () => {
    const allSO = [...SO_CREDENTIAL_NAMES];
    const score = computeSoPoints(member(allSO));
    expect(score).toBe(13);
  });

  it('member with only 3 ops certs scores 3', () => {
    const score = computeSoPoints(
      member([
        'Hazardous Materials Operations',
        'Rope Rescue Operations',
        'Confined Space Operations',
      ]),
    );
    expect(score).toBe(3);
  });

  it('member with no SO creds scores 0', () => {
    expect(computeSoPoints(member(['Car Seat Technician']))).toBe(0);
  });
});
