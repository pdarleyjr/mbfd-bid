// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  invalidateWorkingBidBoards,
  usePersonnelProjectionRefresh,
} from '../../lib/admin-projection-refresh';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

it('annual edits invalidate Upcoming while retaining immutable Previous and dated Current caches', async () => {
  const client = new QueryClient();
  for (const view of ['previous', 'current', 'upcoming'])
    client.setQueryData(['admin', 'bid-board', view, 'A', '2027'], { view });
  await invalidateWorkingBidBoards(client, ['upcoming']);
  expect(client.getQueryState(['admin', 'bid-board', 'previous', 'A', '2027'])?.isInvalidated).toBe(
    false,
  );
  expect(client.getQueryState(['admin', 'bid-board', 'current', 'A', '2027'])?.isInvalidated).toBe(
    false,
  );
  expect(client.getQueryState(['admin', 'bid-board', 'upcoming', 'A', '2027'])?.isInvalidated).toBe(
    true,
  );
  client.clear();
});
it.each(['personnel', 'qualification'] as const)(
  '%s changes refresh dependent views without invalidating Previous',
  async (kind) => {
    const client = new QueryClient();
    const keys = [
      ['admin', 'bid-board', 'previous', 'A', '2027'],
      ['admin', 'bid-board', 'current', 'A', '', '2027-01-01'],
      ['admin', 'bid-board', 'upcoming', 'A', '2027'],
      ['admin', 'annual-plan', 2027],
      ['admin', 'current-roster', '2027-01-01'],
      ['admin', 'credentials'],
    ] as const;
    for (const key of keys) client.setQueryData(key, { source: 'last successful data' });
    let refresh: ReturnType<typeof usePersonnelProjectionRefresh> | undefined;
    function MutationReceipt() {
      refresh = usePersonnelProjectionRefresh();
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    router.refresh.mockClear();
    try {
      act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <MutationReceipt />
          </QueryClientProvider>,
        ),
      );
      await act(async () => {
        await refresh?.(kind);
      });
      expect(router.refresh).toHaveBeenCalledTimes(1);
      expect(client.getQueryState(keys[0])?.isInvalidated).toBe(false);
      expect(client.getQueryState(keys[1])?.isInvalidated).toBe(kind === 'personnel');
      expect(client.getQueryState(keys[2])?.isInvalidated).toBe(true);
      expect(client.getQueryState(keys[3])?.isInvalidated).toBe(true);
      expect(client.getQueryState(keys[4])?.isInvalidated).toBe(kind === 'personnel');
      expect(client.getQueryState(keys[5])?.isInvalidated).toBe(kind === 'qualification');
      for (const key of keys)
        expect(client.getQueryData(key)).toEqual({ source: 'last successful data' });
    } finally {
      act(() => root.unmount());
      client.clear();
    }
  },
);
