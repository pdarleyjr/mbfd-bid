import { describe, expect, it } from 'vitest';

import { classifyCertificationReadiness } from '../../src/lib/certification-readiness.js';

describe('classifyCertificationReadiness', () => {
  it('does not invent an annual evaluation date and classifies effective evidence', () => {
    const rows = classifyCertificationReadiness({
      asOf: '2026-09-01',
      expiringSoonDays: 30,
      annualEvaluationOn: null,
      rows: [
        {
          memberId: 1,
          memberName: 'Avery Operator',
          rank: 'FF',
          credential: 'Paramedic',
          specialty: null,
          status: 'active',
          effectiveOn: '2026-01-01',
          expiresOn: '2026-09-15',
          evidenceSource: 'State',
          evidenceReference: 'P-1',
          changedAt: '2026-08-30',
        },
        {
          memberId: 2,
          memberName: 'Blair Operator',
          rank: 'LT',
          credential: 'Officer',
          specialty: null,
          status: 'expired',
          effectiveOn: '2026-01-01',
          expiresOn: '2026-08-31',
          evidenceSource: 'State',
          evidenceReference: null,
          changedAt: '2026-01-01',
        },
      ],
    });

    expect(rows.annualDetermination).toBe('PENDING_CONFIGURATION');
    expect(rows.items.map((item) => item.classification)).toEqual(['EXPIRING_SOON', 'EXPIRED']);
    expect(rows.items[0]).toMatchObject({ recentlyChanged: true, sourceProvenance: 'State' });
  });
});
