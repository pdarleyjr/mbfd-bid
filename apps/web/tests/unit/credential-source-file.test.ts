import { describe, expect, it } from 'vitest';
import { credentialRowsToCsv } from '../../app/admin/targetsolutions/credential-source-file';

describe('credential source file conversion', () => {
  it('preserves identifiers, blank expiration and quoted credential names', () => {
    expect(
      credentialRowsToCsv([
        ['Employee ID', 'Credential Name', 'Start Date', 'Expiration Date'],
        ['0012', 'Course, advanced', new Date('2020-01-15T00:00:00.000Z'), null],
      ]),
    ).toBe(
      'Employee ID,Credential Name,Start Date,Expiration Date\r\n0012,"Course, advanced",2020-01-15,',
    );
  });
});
