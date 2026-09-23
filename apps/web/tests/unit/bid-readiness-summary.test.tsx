import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BidReadinessSummary } from '../../app/admin/current-bid/BidReadinessSummary';

it('gives a 2026 Bid administrator plain-English next steps without readiness codes', () => {
  const html = renderToStaticMarkup(
    <BidReadinessSummary
      year={2026}
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
  expect(html).toContain('Policy: Ready');
  expect(html).toContain('4 Real activation reviews remain');
  expect(html).toContain('Positions: Ready');
  expect(html).toContain('Bid order: Preview participant stages');
  expect(html).toContain('Credentials: Provisional source review required');
  expect(html).toContain('A-Day timing: Source-backed timing is still needed');
  expect(html).toContain('Mock rehearsal: Ready to prepare safely');
  expect(html).toContain('Live: 4 activation reviews remain');
  expect(html).toContain('Review credentials');
  expect(html).toContain('Review A-Day');
  expect(html).toContain('Prepare Mock');
  expect(html).toContain('Check Managed Live readiness');
  expect(html).not.toMatch(/bid_configuration_|stage_participant_|readiness_check/i);
});
