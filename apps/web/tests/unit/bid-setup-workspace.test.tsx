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

  it('offers the reviewed source bootstrap only for an empty 2026 configuration', () => {
    const html = renderToString(
      <BidSetupWorkspace
        year={2026}
        configuration={{
          bidYear: 2026,
          bidYearStatus: 'configuring',
          ruleBookVersion: null,
          positionTemplateVersion: null,
          configurationRevision: 0,
          ruleBookRevision: null,
          settings: null,
          lifecycle: 'UNCONFIGURED',
        }}
        ruleBooks={[]}
        configurationError={null}
        ruleBooksError={null}
      />,
    );

    expect(html).toContain('Initialize reviewed 2026 source');
    expect(html).toContain('data-testid="reviewed-2026-source-bootstrap"');
    expect(html).toContain('does not designate, publish, or start a Bid');
  });

  it('does not offer the 2026 source bootstrap for another year', () => {
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
        ruleBooks={[]}
        configurationError={null}
        ruleBooksError={null}
      />,
    );

    expect(html).not.toContain('data-testid="reviewed-2026-source-bootstrap"');
  });

  it('offers a guarded replacement draft for a frozen configuring year', () => {
    const html = renderToString(
      <BidSetupWorkspace
        year={2027}
        configuration={{
          ...DRAFT_CONFIGURATION,
          ruleBookVersion: '2027.2',
          settings: {
            ...DRAFT_CONFIGURATION.settings,
            v: 3,
            livePolicy: {
              v: 1,
              policyRevision: 'synthetic-ui-test',
              stages: [],
              dispositions: [],
              actionPermissions: [],
              annualOperations: {
                v: 1,
                stageOrder: [],
                requiredTopologyPositionIds: [],
                contact: {
                  minimumAttempts: 3,
                  timingMode: 'OPERATOR_DISCRETION',
                  durationSeconds: null,
                },
                aDay: {
                  combatGroups: ['G1', 'G2', 'G3', 'G4'],
                  min: 18,
                  max: 19,
                  captainDcMax: 2,
                  specialtyMaximums: {
                    MARINE_ASSIGNED: 1,
                    MARINE_FLOAT: 1,
                    DE: 2,
                    SWAT: 1,
                  },
                },
              },
              specialtyCatalogReference: null,
              aDayPolicyReference: null,
              transitionPolicyReference: null,
              publicationPolicyReference: null,
            },
          },
          lifecycle: 'FROZEN',
        }}
        ruleBooks={[
          { version: '2027.2', effectiveYear: 2027, status: 'active' },
          { version: '2027.3', effectiveYear: 2027, status: 'draft' },
        ]}
        configurationError={null}
        ruleBooksError={null}
      />,
    );

    expect(html).toContain('Designate reviewed replacement draft');
    expect(html).toContain('<option value="2027.3">');
    expect(html).toContain(' (draft)');
    expect(html).toContain('blocks the replacement if any real session history exists');
    expect(html).toContain('value="2027-01-15"');
    expect(html).toContain('data-testid="bid-configuration-save"');
  });
});
