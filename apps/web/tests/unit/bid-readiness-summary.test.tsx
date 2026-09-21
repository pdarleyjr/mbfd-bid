import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BidReadinessSummary } from '../../app/admin/current-bid/BidReadinessSummary';

it('gives a 2026 Bid administrator plain-English next steps without readiness codes', () => {
  const html = renderToStaticMarkup(
    <BidReadinessSummary
      year={2026}
      policyReady
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
  expect(html).toContain('Positions: Ready');
  expect(html).toContain('Bid order: Preview participant stages');
  expect(html).toContain('Credentials: Provisional source review required');
  expect(html).toContain('A-Day timing: Source-backed timing is still needed');
  expect(html).toContain('Mock rehearsal: Not completed with the current Bid evidence');
  expect(html).toContain('Live: Check readiness after the review items are resolved');
  expect(html).toContain('Review credentials');
  expect(html).toContain('Review A-Day');
  expect(html).toContain('Prepare Mock');
  expect(html).toContain('Check Managed Live readiness');
  expect(html).not.toMatch(/bid_configuration_|stage_participant_|readiness_check/i);
});
