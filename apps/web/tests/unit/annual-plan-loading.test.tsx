// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AnnualPlanWorkspace } from '../../app/admin/annual-plan/AnnualPlanWorkspace';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/annual-plan',
  useSearchParams: () => new URLSearchParams('year=2027&stage=1'),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

it.each(['saved draft', 'unavailable source'])(
  'does not offer blank creation while checking %s',
  async (scenario) => {
    let resolveList: (response: Response) => void = () => {};
    let resolveDetail: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === '/api/admin/annual-plan')
          return new Promise<Response>((resolve) => {
            resolveList = resolve;
          });
        if (String(input) === '/api/admin/annual-plan/2027')
          return new Promise<Response>((resolve) => {
            resolveDetail = resolve;
          });
        return Promise.resolve(Response.json({ sources: [] }));
      }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <AnnualPlanWorkspace />
          </QueryClientProvider>,
        ),
      );
      expect(container.textContent).toContain('Checking saved plan');
      expect(container.querySelector('form')).toBeNull();
      await act(async () => {
        resolveList(
          Response.json(
            scenario === 'saved draft'
              ? { plans: [{ year: 2027, ruleBookStatus: 'draft', effectiveOn: null }] }
              : { error: 'synthetic_unavailable' },
            { status: scenario === 'saved draft' ? 200 : 503 },
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.querySelector('form')).toBeNull();
      if (scenario === 'unavailable source') {
        await vi.waitFor(() =>
          expect(container.textContent).toContain('Saved preparation could not be verified'),
        );
        expect(container.textContent).not.toContain('Not started');
      } else {
        await vi.waitFor(async () => {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          expect(fetch).toHaveBeenCalledWith('/api/admin/annual-plan/2027', {
            credentials: 'include',
          });
        });
        await act(async () => {
          resolveDetail(
            Response.json({
              plan: {
                year: 2027,
                effectiveOn: null,
                lifecycle: 'DRAFT',
                settings: {
                  v: 1,
                  turnTimerSeconds: 90,
                  expectedDurationDays: 3,
                  credentialEvaluationOn: '2027-01-01',
                },
              },
              coverage: null,
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await vi.waitFor(() =>
          expect(container.textContent).toContain('Review existing draft for guided preparation'),
        );
        expect(container.textContent).not.toContain('Not started');
      }
    } finally {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
