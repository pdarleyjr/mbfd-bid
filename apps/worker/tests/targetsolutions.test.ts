import { describe, expect, it } from 'vitest';
import { classifyTargetCredential, parseTargetSolutions } from '../src/lib/targetsolutions.js';

const exportText =
  '\uFEFFCredentials\r\nType:,Credentials\r\nRun Date:,"Sep 7, 2026 4:34 PM"\r\nFilters:,Credential Status,Active\r\n\r\nFirst Name,Last Name,Employee ID,Credential Name\r\nTest,Member,00012,"Course, advanced"\r\n';
function firstRow() {
  const row = parseTargetSolutions(exportText).rows[0];
  if (!row) throw new Error('Expected parsed row');
  return row;
}
describe('TargetSolutions source interpretation', () => {
  it('reads report preambles and quoted CSV without converting employee identities', () => {
    const report = parseTargetSolutions(exportText);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      employeeId: '00012',
      credentialName: 'Course, advanced',
      expiresOn: null,
    });
    expect(report.observedOn).toBe('2026-09-07');
    expect(report.coverage.expirationDates).toBe(false);
    expect(report.errors).toEqual([]);
  });
  it('rejects duplicate contradictory rows and invalid dates instead of guessing', () => {
    const report = parseTargetSolutions(
      'Employee ID,Credential Name,Expiration Date\n1,Test,2026-02-30\n1,Test,2026-12-01',
    );
    expect(report.errors.length).toBeGreaterThan(0);
  });
  it('does not turn active report presence into renewal or clear a known expiration', () => {
    const row = firstRow();
    expect(
      classifyTargetCredential(
        row,
        { status: 'active', effectiveOn: '2025-01-01', expiresOn: '2027-01-01' },
        '2026-09-07',
      ),
    ).toBe('UNCHANGED');
    expect(
      classifyTargetCredential(
        row,
        { status: 'expired', effectiveOn: '2025-01-01', expiresOn: '2026-01-01' },
        '2026-09-07',
      ),
    ).toBe('CONFLICT');
  });
  it('separates missing dates, renewals and adverse changes', () => {
    const row = { ...firstRow(), expiresOn: '2027-12-01' };
    expect(
      classifyTargetCredential(
        row,
        { status: 'active', effectiveOn: null, expiresOn: null },
        '2026-09-07',
      ),
    ).toBe('FILL_MISSING_DATE');
    expect(
      classifyTargetCredential(
        row,
        { status: 'active', effectiveOn: '2025-01-01', expiresOn: '2027-01-01' },
        '2026-09-07',
      ),
    ).toBe('RENEWAL');
    expect(
      classifyTargetCredential(
        { ...row, expiresOn: '2026-08-01' },
        { status: 'active', effectiveOn: null, expiresOn: null },
        '2026-09-07',
      ),
    ).toBe('EXPIRATION_REVIEW');
  });
  it('requires an explicit status column or active report filter', () => {
    expect(
      parseTargetSolutions('Employee ID,Credential Name\n1,Course').errors.join(' '),
    ).toContain('status');
  });
});
