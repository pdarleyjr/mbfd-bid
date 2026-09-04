import { describe, expect, it } from 'vitest';

import { operationalDate } from '../../src/lib/operational-date.js';

describe('MBFD operational calendar date', () => {
  it('keeps the Eastern calendar date after UTC midnight', () => {
    expect(operationalDate(new Date('2026-09-04T00:30:00.000Z'))).toBe('2026-09-03');
  });

  it('advances at Eastern midnight across daylight-saving time', () => {
    expect(operationalDate(new Date('2026-09-04T03:59:59.999Z'))).toBe('2026-09-03');
    expect(operationalDate(new Date('2026-09-04T04:00:00.000Z'))).toBe('2026-09-04');
  });
});
