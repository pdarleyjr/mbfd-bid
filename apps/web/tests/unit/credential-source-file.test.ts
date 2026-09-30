import { describe, expect, it, vi } from 'vitest';
import {
  credentialRowsToCsv,
  credentialSourceText,
  discoverCredentialRevisions,
} from '../../app/admin/targetsolutions/credential-source-file';

const reader = vi.hoisted(() => vi.fn());
vi.mock('read-excel-file/browser', () => ({ default: reader }));
const header = [
  'First Name',
  'Last Name',
  'Employee ID',
  'Rank',
  'Credential Name',
  'Expiration Date',
  'Start Date',
];
const data = [
  header,
  [
    'Test',
    'Member',
    '25611',
    'Firefighter',
    'FL State - EMT - Basic',
    '2028-12-01 00:00:00',
    '2026-12-01 00:00:00',
  ],
];

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
  it('discovers numeric revisions, identifies the latest, and counts named Employee ID values', () => {
    const revisions = discoverCredentialRevisions(
      [1, 4, 2, 10, 3].map((revision) => ({
        sheet: `2026_BID_Credentials_Version_${revision}_`,
        data,
      })),
    );
    expect(revisions.map((revision) => revision.revision)).toEqual([10, 4, 3, 2, 1]);
    expect(revisions[0]).toMatchObject({ rowCount: 1, employeeCount: 1 });
  });
  it('normalizes midnight date strings by header with expiration before start', () => {
    expect(credentialRowsToCsv(data)).toContain('2028-12-01,2026-12-01');
    const reversed = [
      header.slice(0, 5).concat(['Start Date', 'Expiration Date']),
      data[1]?.slice(0, 5).concat(['2026-12-01 00:00:00', '2028-12-01 00:00:00']) ?? [],
    ];
    expect(credentialRowsToCsv(reversed)).toContain('2026-12-01,2028-12-01');
  });
  it('requires selection for multi-revision workbooks and never falls back from a missing selection', async () => {
    reader.mockResolvedValue(
      [1, 4].map((revision) => ({ sheet: `2026_BID_Credentials_Version_${revision}_`, data })),
    );
    const file = { name: 'annual.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File;
    await expect(credentialSourceText(file)).rejects.toThrow('Select a credential revision');
    await expect(credentialSourceText(file, '2026_BID_Credentials_Version_3_')).rejects.toThrow(
      'absent',
    );
    await expect(credentialSourceText(file, '2026_BID_Credentials_Version_4_')).resolves.toContain(
      '2028-12-01,2026-12-01',
    );
  });
  it('retains Version-1-only workbook support', async () => {
    reader.mockResolvedValue([{ sheet: '2026_BID_Credentials_Version_1_', data }]);
    const file = { name: 'old.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File;
    await expect(credentialSourceText(file)).resolves.toContain('25611');
  });
});
