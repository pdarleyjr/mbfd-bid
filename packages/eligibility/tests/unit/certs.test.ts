import { describe, expect, it } from 'vitest';
import { requiredCredsSatisfied } from '../../src/criteria/certs.js';
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

describe('requiredCredsSatisfied', () => {
  it('returns empty array when no credentials required', () => {
    const reasons = requiredCredsSatisfied(withCreds([]), []);
    expect(reasons).toHaveLength(0);
  });

  it('member holds the required cert — satisfied', () => {
    const reasons = requiredCredsSatisfied(withCreds(['Hazardous Materials Operations']), [
      'Hazardous Materials Operations',
    ]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.satisfied).toBe(true);
    expect(reasons[0]?.code).toBe('CRED_OK');
  });

  it('member missing one of two required certs — one unsatisfied', () => {
    const reasons = requiredCredsSatisfied(withCreds(['Hazardous Materials Operations']), [
      'Hazardous Materials Operations',
      'Merchant Mariner Credential (MMC)',
    ]);
    expect(reasons).toHaveLength(2);
    const missing = reasons.find((r) => !r.satisfied);
    expect(missing).toBeDefined();
    expect(missing?.code).toBe('CRED_MISSING');
    expect(missing?.label).toMatch(/Merchant Mariner/);
  });

  it('returns one reason per required credential', () => {
    const required = ['Cred A', 'Cred B', 'Cred C'];
    const reasons = requiredCredsSatisfied(withCreds(['Cred A']), required);
    expect(reasons).toHaveLength(3);
  });
});
