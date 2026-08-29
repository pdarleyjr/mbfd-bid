import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ serverWorkerFetch: vi.fn() }));

vi.mock('@/lib/server-worker-fetch', () => ({ serverWorkerFetch: mocks.serverWorkerFetch }));

const SEARCH = {
  year: '2027',
  rule_book_version: '2027.2',
  template_version: '2027.1',
  configuration_revision: '4',
};

const CONFIGURATION = {
  bidYear: 2027,
  bidYearStatus: 'configuring',
  ruleBookVersion: '2027.2',
  positionTemplateVersion: '2027.1',
  configurationRevision: 4,
  ruleBookRevision: 9,
  settings: {
    v: 2,
    expectedDurationDays: 2,
    turnTimerSeconds: 180,
    credentialEvaluationOn: '2027-01-15',
  },
  lifecycle: 'DRAFT',
} as const;

describe('loadBoundBidConfiguration', () => {
  beforeEach(() => {
    mocks.serverWorkerFetch.mockReset();
  });

  it('re-verifies the exact designated configuration named in the Bid Setup link', async () => {
    mocks.serverWorkerFetch.mockResolvedValue(
      new Response(JSON.stringify({ configuration: CONFIGURATION }), { status: 200 }),
    );
    const { loadBoundBidConfiguration } = await import('../../lib/load-bound-bid-configuration');

    const result = await loadBoundBidConfiguration(SEARCH);

    expect(mocks.serverWorkerFetch).toHaveBeenCalledWith('/api/admin/bid-configuration/2027');
    expect(result).toMatchObject({ error: null, selection: { year: 2027 } });
    if (result.configuration === null) throw new Error('Expected a bound configuration.');
    expect(result.configuration.ruleBookVersion).toBe('2027.2');
    expect(result.configuration.positionTemplateVersion).toBe('2027.1');
  });

  it('fails closed instead of substituting a newer or different configuration', async () => {
    mocks.serverWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          configuration: { ...CONFIGURATION, configurationRevision: 5, ruleBookVersion: '2027.3' },
        }),
        { status: 200 },
      ),
    );
    const { loadBoundBidConfiguration } = await import('../../lib/load-bound-bid-configuration');

    const result = await loadBoundBidConfiguration(SEARCH);

    expect(result.configuration).toBeNull();
    expect(result.error).toContain('changed after this link was created');
  });
});
