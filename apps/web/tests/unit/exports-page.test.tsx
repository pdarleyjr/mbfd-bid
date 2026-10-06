import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExportsPage from '../../app/admin/exports/page';

const requests = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/server-worker-fetch', () => ({ serverWorkerFetch: requests.fetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => requests.fetch.mockReset());

describe('Bid reports session context', () => {
  it('keeps direct shift exports available even when older archive and portal services fail', async () => {
    requests.fetch.mockResolvedValue(new Response(null, { status: 503 }));
    const page = await ExportsPage({
      searchParams: Promise.resolve({ session_id: 'known-mock', shift: 'D' }),
    });
    const html = renderToString(page);
    expect(requests.fetch).toHaveBeenCalledTimes(2);
    expect(html).toContain('Shift views');
    expect(html).toContain('Download PDF');
    expect(html).toContain('Excel (.xlsx)');
    expect(html).toContain('<option value="D" selected="">Days</option>');
    expect(html).toContain('Previous exports could not be loaded');
    expect(html).toContain('Portal sync status could not be loaded');
    expect(html).not.toContain('All picks synced to portal.');
    expect(html).not.toContain('Worker logs');
    expect(html).not.toContain('JWT');
  });

  it('defaults to all shifts for a saved session opened without a selected shift', async () => {
    requests.fetch.mockImplementation(async (path: string) =>
      Response.json(path.includes('portal-status') ? { bids: [] } : { exports: [] }),
    );
    const html = renderToString(
      await ExportsPage({ searchParams: Promise.resolve({ session_id: 'known-real' }) }),
    );
    expect(html).toContain('<option value="ALL" selected="">All shifts</option>');
    expect(html).toContain('Detailed reports and previous exports');
    expect(html).toContain('/api/admin/exports/known-real/progress.csv');
  });

  it('recovers an invalid session URL through the verified active-session selection', async () => {
    requests.fetch.mockResolvedValue(
      Response.json({
        session: { id: 'verified-active', bidYear: 2026, isMock: true, currentPhase: 'paused' },
      }),
    );
    const html = renderToString(
      await ExportsPage({ searchParams: Promise.resolve({ session_id: 'invalid/path' }) }),
    );
    expect(requests.fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/bid-session/active');
    expect(html).toContain('/admin/exports?session_id=verified-active');
    expect(html).not.toContain('Download PDF');
    expect(html).not.toContain('invalid/path');
  });
});
