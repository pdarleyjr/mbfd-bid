// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealBidAccess } from '../../app/admin/_components/RealBidAccess';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let fetcher: ReturnType<typeof vi.fn>;
const prepare = vi.fn();

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepare.mockReset();
  fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => {
  await act(() => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
function listing(sessions: unknown[], year = 2026) {
  return Response.json({ plan: { year, sessions } });
}
async function mount(props: Partial<Parameters<typeof RealBidAccess>[0]> = {}) {
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <RealBidAccess year={2026} {...props} />
      </QueryClientProvider>,
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}
const run = (id: string, isMock: boolean | number, currentPhase: string) => ({
  id,
  isMock,
  currentPhase,
  // This legacy timestamp is creation metadata, not a Start command.
  startedAt: 1791200000000,
});

describe('persistent Real Bid access', () => {
  it.each([false, 0])(
    'reopens the prepared Real after a fresh page mount: isMock=%s',
    async (flag) => {
      fetcher.mockResolvedValue(
        listing([
          run('newer-mock', 1, 'position_bid'),
          run('real / prepared', flag, 'config'),
          run('old-real', 0, 'complete'),
        ]),
      );
      await mount({ disabled: true, onPrepare: prepare });
      const link = host.querySelector('a');
      expect(link?.textContent).toBe('Open Real Bid');
      expect(link?.getAttribute('href')).toBe('/admin/bid?session_id=real%20%2F%20prepared');
      expect(host.textContent).toContain('Ready to start');
      expect(host.textContent).not.toContain('Prepare Real Bid');
      expect(prepare).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/annual-plan/2026');
      expect(fetcher.mock.calls[0]?.[1].method).toBeUndefined();
      expect(fetcher.mock.calls[0]?.[1].body).toBeUndefined();
    },
  );

  it.each([
    ['paused', 'Paused · progress saved'],
    ['position_bid', 'In progress'],
  ])('opens %s without issuing a Start or Resume', async (phase, label) => {
    fetcher.mockResolvedValue(listing([run('existing-real', false, phase)]));
    await mount();
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/bid?session_id=existing-real',
    );
    expect(host.textContent).toContain(label);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shows creation only when no open Real exists, retaining the normal callback', async () => {
    fetcher.mockResolvedValue(listing([run('mock', true, 'config'), run('past', 0, 'complete')]));
    await mount({ onPrepare: prepare });
    expect(host.textContent).toBe('Prepare Real Bid');
    await act(() => host.querySelector('button')?.click());
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('links the home page to the correct year when preparation is needed', async () => {
    fetcher.mockResolvedValue(listing([]));
    await mount();
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/current-bid?year=2026&view=live',
    );
  });

  it('offers every existing Real if the listing is ambiguous instead of creating another', async () => {
    fetcher.mockResolvedValue(listing([run('first', 0, 'config'), run('second', 0, 'paused')]));
    await mount({ onPrepare: prepare });
    expect([...host.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/admin/bid?session_id=first',
      '/admin/bid?session_id=second',
    ]);
    expect(host.textContent).toContain('Choose an existing session');
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    listing([run('wrong-year-real', 0, 'config')], 2027),
    listing([run('duplicate', 0, 'config'), run('duplicate', 0, 'config')]),
    Response.json({ error: 'unauthorized' }, { status: 401 }),
    Response.json({ plan: { year: 2026, sessions: [{ id: 'invalid', isMock: 'false' }] } }),
  ])('does not offer creation or a wrong session when discovery fails', async (response) => {
    fetcher.mockResolvedValue(response);
    await mount({ onPrepare: prepare });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).not.toContain('Prepare Real Bid');
    fetcher.mockResolvedValue(listing([run('recovered', 0, 'config')]));
    await act(() => host.querySelector('button')?.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/admin/bid?session_id=recovered');
  });

  it('keeps the just-created session directly accessible before discovery refreshes', async () => {
    fetcher.mockResolvedValue(listing([]));
    await mount({ createdRealId: 'just-created', onPrepare: prepare });
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/bid?session_id=just-created',
    );
    expect(host.textContent).not.toContain('Prepare Real Bid');
  });

  it('shows loading while discovery is pending instead of inviting duplicate preparation', async () => {
    fetcher.mockReturnValue(new Promise(() => {}));
    await mount({ onPrepare: prepare });
    expect(host.textContent).toContain('Loading your Real Bid');
    expect(host.querySelector('button')).toBeNull();
  });
});
