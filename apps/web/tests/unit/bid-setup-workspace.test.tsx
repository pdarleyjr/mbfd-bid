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
  settings: {
    v: 2 as const,
    expectedDurationDays: 2,
    turnTimerSeconds: 180,
    credentialEvaluationOn: '2027-01-15',
  },
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
    expect(html).toContain('Credential evaluation date');
    expect(html).toContain('2027-01-15');
    expect(html).toContain('Rule Books');
    expect(html).toContain('Bid Access PIN');
  });

  it('carries the exact designated configuration into every downstream policy tool', () => {
    const html = renderToString(
      <BidSetupWorkspace
        year={2027}
        configuration={DRAFT_CONFIGURATION}
        ruleBooks={[{ version: '2027.2', effectiveYear: 2027, status: 'draft' }]}
        configurationError={null}
        ruleBooksError={null}
      />,
    );

    const selection =
      'year=2027&amp;rule_book_version=2027.2&amp;template_version=2027.1&amp;configuration_revision=4';
    expect(html).toContain(`/admin/positions?${selection}`);
    expect(html).toContain(`/admin/rules?${selection}`);
    expect(html).toContain(`/admin/eligibility?${selection}`);
    expect(html).not.toContain('href="/admin/positions"');
    expect(html).not.toContain('href="/admin/rules"');
    expect(html).not.toContain('href="/admin/eligibility"');
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

  it('does not preselect the first draft when a year has no designated configuration', () => {
    const html = renderToString(
      <BidSetupWorkspace
        year={2028}
        configuration={{
          bidYear: 2028,
          bidYearStatus: 'configuring',
          ruleBookVersion: null,
          positionTemplateVersion: null,
          configurationRevision: 0,
          ruleBookRevision: null,
          settings: null,
          lifecycle: 'UNCONFIGURED',
        }}
        ruleBooks={[
          { version: '2028.1', effectiveYear: 2028, status: 'draft' },
          { version: '2028.2', effectiveYear: 2028, status: 'draft' },
        ]}
        configurationError={null}
        ruleBooksError={null}
      />,
    );

    expect(html).toContain('Select a draft candidate');
    expect(html).toContain('<option value="" selected="">Select a draft candidate</option>');
    expect(html).not.toContain('<option value="2028.1" selected="">');
  });
});
