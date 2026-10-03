import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BidReadinessSummary } from '../../app/admin/current-bid/BidReadinessSummary';

it('gives a 2026 Bid administrator plain-English next steps without readiness codes', () => {
  const html = renderToStaticMarkup(
    <BidReadinessSummary
      year={2026}
      content={{
        v: 1,
        bidYear: 2026,
        settings: null,
        notes: { bid: null, positions: null },
        policy: null,
        planning: null,
        authoring: null,
        positions: [],
        rules: [],
        participation: [],
        staffingBindings: [],
        sourceDecisions: [],
      }}
      policyReady
      realActivationReviewCount={4}
      positionsReady
      participantStagesConfigured
      aDayConfigured={false}
      onOpenEdit={vi.fn()}
      onOpenMock={vi.fn()}
      onOpenLive={vi.fn()}
    />,
  );

  expect(html).toContain('2026 BID READINESS');
  expect(html).toContain('Source package: Ready');
  expect(html).toContain('4 open source or evidence reviews');
  expect(html).toContain('Review launch advisories');
  expect(html).toContain('Starting does not resolve open questions or approve held credentials');
  expect(html).toContain('Positions: Ready');
  expect(html).toContain('Biddable seat inventory: Blocking');
  expect(html).toContain('Expected: 73 per shift, four open Days seats, 223 total');
  expect(html).toContain('Participants: Ready');
  expect(html).toContain('Seniority / order: Ready');
  expect(html).toContain('Credentials: Needs Confirmation');
  expect(html).toContain('Specialty populations: Ready');
  expect(html).toContain('A-Day constraints: Blocking');
  expect(html).toContain('Operators / permissions: Needs Confirmation');
  expect(html).toContain('Operating settings: Needs Confirmation');
  expect(html).toContain('Mock rehearsal: Blocking');
  expect(html).toContain('Live readiness: Needs Confirmation');
  expect(html).toContain('Review credentials');
  expect(html).toContain('Review A-Day');
  expect(html).toContain('Prepare Mock');
  expect(html).toContain('Check Managed Live readiness');
  expect(html).not.toMatch(/bid_configuration_|stage_participant_|readiness_check/i);
});
