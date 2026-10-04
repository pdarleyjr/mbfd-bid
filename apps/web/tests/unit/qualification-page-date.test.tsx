import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';

vi.mock('@/lib/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/server-worker-fetch', () => ({
  serverWorkerFetch: vi.fn(async () => Response.json({ members: [], credentials: [] })),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import QualificationLifecyclePage from '../../app/admin/personnel/qualifications/page';

afterEach(() => vi.useRealTimers());

describe('qualification evidence local date', () => {
  it.each([
    ['2026-10-04T02:00:00Z', '2026-10-03'],
    ['2026-12-04T04:30:00Z', '2026-12-03'],
    ['2026-12-04T05:30:00Z', '2026-12-04'],
  ])('uses MBFD calendar date for %s', async (instant, localDate) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    const page = await QualificationLifecyclePage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(<AdminQueryProvider>{page}</AdminQueryProvider>);
    expect(html).toContain(`As of ${localDate}`);
    expect(html).toMatch(
      new RegExp(`data-testid="qualification-effective-on"[^>]+value="${localDate}"`),
    );
  });
});
