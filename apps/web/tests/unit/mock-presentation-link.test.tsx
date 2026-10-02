// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionPresentationLink } from '../../app/admin/bid/_components/SessionPresentationLink';
import { MockSessionsTable } from '../../app/admin/rehearsal/_components/MockSessionsTable';
import { SessionOperatorLinks } from '../../app/admin/sessions/[id]/SessionOperatorLinks';
import LivePresentationPage from '../../app/live/page';
import { presentationApiPath, presentationHref } from '../../lib/presentation-link';

const workerFetch = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/require-pin', () => ({ requirePin: vi.fn() }));
vi.mock('@/lib/server-worker-fetch', () => ({ serverWorkerFetch: workerFetch }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('session-bound Mock audience links', () => {
  it.each(['mock / one', 'mock?second&third', 'mock-a'])(
    'encodes the exact session without extra parameters: %s',
    (id) => {
      expect(
        new URL(presentationHref(id), 'https://bid.mbfdhub.com').searchParams.get('bidSessionId'),
      ).toBe(id);
      expect(new URL(presentationApiPath(id), 'https://bid.mbfdhub.com').searchParams.size).toBe(1);
      const markup = renderToStaticMarkup(<SessionPresentationLink sessionId={id} isMock />);
      const host = document.createElement('div');
      host.innerHTML = markup;
      expect(host.querySelector('a')?.getAttribute('href')).toBe(presentationHref(id));
      expect(host.querySelector('a')?.getAttribute('target')).toBe('_blank');
      expect(host.textContent).toContain('Open Mock presentation');
      expect(workerFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['bidSessionId', 'session_id', 'session'])(
    'binds initial server render and client refresh for %s',
    async (alias) => {
      workerFetch.mockResolvedValue(
        Response.json({
          mode: 'OFF',
          sequence: 7,
          session: { id: 'mock / 7', bid_year: 2026, is_mock: true },
        }),
      );
      const page = await LivePresentationPage({
        searchParams: Promise.resolve({ [alias]: 'mock / 7' }),
      });
      expect(workerFetch).toHaveBeenCalledExactlyOnceWith(
        '/api/presentation?bidSessionId=mock%20%2F%207',
      );
      expect(page.props.sessionId).toBe('mock / 7');
      const markup = renderToStaticMarkup(page);
      expect(markup).toContain('MOCK SESSION');
      expect(markup).toContain('Open this Mock Bid');
    },
  );

  it('keeps a default presentation on the existing implicit Real endpoint', async () => {
    workerFetch.mockResolvedValue(Response.json({ mode: 'OFF', session: null }));
    const page = await LivePresentationPage({ searchParams: Promise.resolve({}) });
    expect(workerFetch).toHaveBeenCalledExactlyOnceWith('/api/presentation');
    expect(page.props.sessionId).toBeUndefined();
    expect(presentationHref()).toBe('/live');
  });

  it('never renders a different session returned for an explicit Mock request', async () => {
    workerFetch.mockResolvedValue(
      Response.json({
        mode: 'LIVE',
        session: { id: 'real-bid', bid_year: 2026 },
        current_bidder: { name: 'Wrong bidder', member_id: 99, rank: 'FF' },
      }),
    );
    const page = await LivePresentationPage({
      searchParams: Promise.resolve({ bidSessionId: 'mock-a' }),
    });
    expect(renderToStaticMarkup(page)).not.toContain('Wrong bidder');
    expect(page.props.initial).toEqual({ mode: 'OFF', session: null });
  });

  it('provides a direct audience link for every retained Mock row and session detail', () => {
    const html = renderToStaticMarkup(
      <MockSessionsTable
        sessions={['config-mock', 'started-mock', 'complete-mock'].map((id, index) => ({
          id,
          bidYear: 2026,
          currentPhase: ['config', 'position_bid', 'complete'][index] ?? 'config',
          currentBidderId: null,
          mockControlRevision: 0,
          isMock: true,
          lastPickedAtIso: null,
        }))}
      />,
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(
      [...host.querySelectorAll('a')]
        .filter((a) => a.textContent === 'Open Mock presentation')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['config-mock', 'started-mock', 'complete-mock'].map(presentationHref));
    expect(renderToStaticMarkup(<SessionOperatorLinks sessionId="config-mock" />)).toContain(
      presentationHref('config-mock'),
    );
  });

  it.each([true, false])(
    'copies the same link and recovers from unavailable clipboard: %s',
    async (allowed) => {
      const writeText = vi.fn();
      if (allowed) writeText.mockResolvedValue(undefined);
      else writeText.mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(() => root.render(<SessionPresentationLink sessionId="mock-a" isMock />));
      await act(() => host.querySelector('button')?.click());
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        `${window.location.origin}/live?bidSessionId=mock-a`,
      );
      expect(host.textContent).toContain(
        allowed ? 'Presentation link copied.' : 'Copy unavailable.',
      );
      await act(() => root.unmount());
      host.remove();
    },
  );
});
