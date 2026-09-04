import { describe, expect, it } from 'vitest';

import { buildCurrentRosterPrintQuery } from '../../app/admin/current-rosters/print/query';

describe('current roster print query', () => {
  it('omits blank filters before calling the strict Worker roster endpoint', () => {
    expect(
      buildCurrentRosterPrintQuery({
        as_of: '2026-09-04',
        shift: '',
        station: '',
        division: '',
        unit: '',
        rank: '',
      }).toString(),
    ).toBe('as_of=2026-09-04');
  });

  it('retains supported nonblank filters and rejects an invalid date', () => {
    expect(
      buildCurrentRosterPrintQuery({
        as_of: '09/04/2026',
        shift: 'A',
        station: 'Station 1',
        unrelated: 'ignored',
      }).toString(),
    ).toBe('shift=A&station=Station+1');
  });
});
