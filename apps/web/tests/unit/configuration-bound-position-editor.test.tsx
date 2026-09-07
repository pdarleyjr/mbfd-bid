import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  routerRefresh: vi.fn(),
  serverWorkerFetch: vi.fn(),
}));

vi.mock('@/lib/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/server-worker-fetch', () => ({ serverWorkerFetch: mocks.serverWorkerFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));

import PositionEditPage from '../../app/admin/positions/[id]/edit/page';

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
};

describe('configuration-bound position rule editor', () => {
  it('loads the position rule only from the exact configured draft and never discovers an arbitrary first draft', async () => {
    mocks.requireAdmin.mockResolvedValue({ role: 'admin', sub: 1 });
    mocks.serverWorkerFetch.mockImplementation(async (path: string) => {
      if (path === '/api/admin/bid-configuration/2027') {
        return new Response(JSON.stringify({ configuration: CONFIGURATION }), { status: 200 });
      }
      if (path === '/api/admin/rules?rule_book_version=2027.2') {
        return new Response(
          JSON.stringify({
            rules: [
              {
                id: 41,
                positionId: 'A205',
                requiredCriteria: { rank: ['LT'], credentials: [], custom: [] },
                pointsPreference: { max: 0, items: [] },
                tieBreakChain: ['rsc_seniority'],
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected worker path: ${path}`);
    });

    const page = PositionEditPage as unknown as (props: {
      params: Promise<{ id: string }>;
      searchParams: Promise<typeof SEARCH>;
    }) => Promise<React.ReactElement>;
    const element = await page({
      params: Promise.resolve({ id: 'A205' }),
      searchParams: Promise.resolve(SEARCH),
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>,
    );

    expect(mocks.serverWorkerFetch).toHaveBeenCalledWith(
      '/api/admin/rules?rule_book_version=2027.2',
    );
    expect(html).toContain('2027.2');
    expect(html).toContain('Editing draft rule');
    expect(html).not.toContain('Rule ID (position_rules.id)');
  });
});
