import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerRpc: vi.fn(),
  positionsGet: vi.fn(),
  requireAdmin: vi.fn(),
  rulesGet: vi.fn(),
  serverWorkerFetch: vi.fn(),
}));

vi.mock('@/lib/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/rpc-server', () => ({ getServerRpc: mocks.getServerRpc }));
vi.mock('@/lib/server-worker-fetch', () => ({ serverWorkerFetch: mocks.serverWorkerFetch }));

import EligibilityPreviewPage from '../../app/admin/eligibility/page';
import AdminPositionsPage from '../../app/admin/positions/page';
import AdminRulesPage from '../../app/admin/rules/page';

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
  settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
  lifecycle: 'DRAFT',
};

const POSITION = {
  id: 'A205',
  templateVersion: '2027.1',
  shift: 'A',
  station: 'Station 2',
  division: 'Combat',
  unit: 'E2',
  rankRequired: 'LT',
  positionName: 'Engine Driver',
  isFloating: false,
  isVacantByDesign: false,
  isExcludedFromCount: false,
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  mocks.requireAdmin.mockReset();
  mocks.requireAdmin.mockResolvedValue({ role: 'admin', sub: 1 });
  mocks.positionsGet.mockReset();
  mocks.positionsGet.mockResolvedValue(
    response({ positions: [POSITION], templateVersion: '2027.1', count: 1 }),
  );
  mocks.rulesGet.mockReset();
  mocks.rulesGet.mockResolvedValue(
    response({
      rules: [
        {
          id: 41,
          ruleBookVersion: '2027.2',
          positionId: 'A205',
          templateVersion: '2027.1',
          requiredCriteria: { rank: ['LT'], credentials: [], custom: [] },
          pointsPreference: { max: 0, items: [] },
          tieBreakChain: ['rsc_seniority'],
          notes: null,
        },
      ],
      ruleBookVersion: '2027.2',
      count: 1,
    }),
  );
  mocks.getServerRpc.mockReset();
  mocks.getServerRpc.mockResolvedValue({
    api: {
      admin: {
        positions: { $get: mocks.positionsGet },
        rules: { $get: mocks.rulesGet },
      },
    },
  });
  mocks.serverWorkerFetch.mockReset();
  mocks.serverWorkerFetch.mockImplementation(async (path: string) => {
    if (path === '/api/admin/bid-configuration/2027')
      return response({ configuration: CONFIGURATION });
    if (path === '/api/admin/members?limit=500&offset=0') {
      return response({
        members: [{ id: 17, firstName: 'Jamie', lastName: 'Rivera', rank: 'LT' }],
        total: 1,
      });
    }
    if (path === '/api/admin/positions?template_version=2027.1') {
      return response({ positions: [POSITION], templateVersion: '2027.1', count: 1 });
    }
    throw new Error(`Unexpected worker path: ${path}`);
  });
});

type BoundPage = (props: { searchParams: Promise<typeof SEARCH> }) => Promise<React.ReactElement>;

describe('configuration-bound setup tools', () => {
  it('loads Positions from the selected template and keeps the context on its edit links', async () => {
    const page = AdminPositionsPage as unknown as BoundPage;
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve(SEARCH) }));

    expect(mocks.positionsGet).toHaveBeenCalledWith({ query: { template_version: '2027.1' } });
    expect(html).toContain('2027.2');
    expect(html).toContain('2027.1');
    expect(html).toContain(
      '/admin/positions/A205/edit?year=2027&amp;rule_book_version=2027.2&amp;template_version=2027.1&amp;configuration_revision=4',
    );
  });

  it('loads Rules from the selected rule book and keeps the same context on its edit link', async () => {
    const page = AdminRulesPage as unknown as BoundPage;
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve(SEARCH) }));

    expect(mocks.rulesGet).toHaveBeenCalledWith({ query: { rule_book_version: '2027.2' } });
    expect(html).toContain('2027.2');
    expect(html).toContain(
      '/admin/positions/A205/edit?year=2027&amp;rule_book_version=2027.2&amp;template_version=2027.1&amp;configuration_revision=4',
    );
  });

  it('binds Eligibility Preview to the selected rule book and offers human-readable member and position choices', async () => {
    const page = EligibilityPreviewPage as unknown as BoundPage;
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve(SEARCH) }));

    expect(html).toContain('2027.2');
    expect(html).toContain('2027.1');
    expect(html).toContain('Rivera, Jamie — LT');
    expect(html).toContain('A205 — Engine Driver');
    expect(html).not.toContain('placeholder="2026.1"');
  });
});
