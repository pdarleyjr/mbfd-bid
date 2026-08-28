import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { BidSetupWorkspace } from '../../app/admin/bid-setup/BidSetupWorkspace';

const DRAFT_CONFIGURATION = {
  bidYear: 2027,
  bidYearStatus: 'configuring' as const,
  ruleBookVersion: '2027.2',
  positionTemplateVersion: '2027.1',
  configurationRevision: 4,
  ruleBookRevision: 9,
  settings: { v: 1 as const, expectedDurationDays: 2, turnTimerSeconds: 180 },
  lifecycle: 'DRAFT' as const,
};

describe('BidSetupWorkspace', () => {
  it('shows the designated configuration revision and existing setup tools', () => {
    const html = renderToString(
      <BidSetupWorkspace
        year={2027}
        configuration={DRAFT_CONFIGURATION}
        ruleBooks={[{ version: '2027.2', effectiveYear: 2027, status: 'draft' }]}
        configurationError={null}
        ruleBooksError={null}
      />,
    );

    expect(html).toContain('Designated annual configuration');
    expect(html).toContain('2027.2');
    expect(html).toContain('Configuration revision');
    expect(html).toContain('>4<');
    expect(html).toContain('Rule Books');
    expect(html).toContain('Bid Access PIN');
  });

  it('fails closed when the selected year has no configuration record', () => {
    const html = renderToString(
      <BidSetupWorkspace
        year={2028}
        configuration={null}
        ruleBooks={[]}
        configurationError="Bid year is not configured."
        ruleBooksError={null}
      />,
    );

    expect(html).toContain('No configuration is available for this bid year');
    expect(html).not.toContain('data-testid="bid-configuration-save"');
  });
});
