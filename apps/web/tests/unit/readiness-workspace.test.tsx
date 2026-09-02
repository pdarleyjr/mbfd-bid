import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReadinessWorkspace } from '../../app/admin/personnel/readiness/ReadinessWorkspace';

describe('ReadinessWorkspace', () => {
  it('exposes command-staff filters and does not infer annual eligibility', () => {
    const html = renderToString(
      <ReadinessWorkspace
        annualDetermination="PENDING_CONFIGURATION"
        items={[
          {
            memberId: 1,
            memberName: 'Avery Operator',
            rank: 'LT',
            credential: 'Paramedic',
            specialty: 'RESCUE',
            classification: 'EXPIRING_SOON',
            effectiveOn: '2026-01-01',
            expiresOn: '2026-09-15',
            sourceProvenance: 'State registry',
            recentlyChanged: true,
            affectedBidOpportunities: 'NOT_DETERMINED_BY_READINESS_PROJECTION',
          },
        ]}
      />,
    );
    expect(html).toContain('pending configuration');
    expect(html).toContain('Rank filter');
    expect(html).toContain('Credential filter');
    expect(html).toContain('Specialty filter');
    expect(html).toContain('Provenance filter');
    expect(html).toContain('Recently changed');
  });
});
