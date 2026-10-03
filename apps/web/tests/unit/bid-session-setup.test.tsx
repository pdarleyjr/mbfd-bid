// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminBidShell } from '../../app/admin/bid/_components/AdminBidShell';
import { BidSessionSetup } from '../../app/admin/bid/_components/BidSessionSetup';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/client-csrf', () => ({ createCsrfAwareFetch: (fetcher: typeof fetch) => fetcher }));
vi.mock('../../app/admin/bid/_components/AdminBoard', () => ({
  AdminBoard: () => <div>Board</div>,
}));
vi.mock('../../app/admin/bid/_components/AnnualLiveControls', () => ({
  AnnualLiveControls: () => <div data-testid="active-selection">Position selection</div>,
}));
vi.mock('../../app/admin/bid/_components/AnnualOperationsStatus', () => ({
  AnnualOperationsStatus: () => <div>Annual operations</div>,
}));
vi.mock('../../app/admin/bid/_components/BidOperatorWorkspace', () => ({
  BidOperatorWorkspace: ({ preview, children }: { preview: boolean; children: ReactNode }) => (
    <div data-testid="workspace" data-preview={String(preview)}>
      Member history {children}
    </div>
  ),
}));
vi.mock('../../app/admin/bid/_components/BidRoster', () => ({
  BidRoster: () => <div>Roster</div>,
}));
vi.mock('../../app/admin/bid/_components/LiveCommandBar', () => ({
  LiveCommandBar: () => <div data-testid="command-bar">Current bidder</div>,
}));
vi.mock('../../app/admin/bid/_components/ManualPickBar', () => ({
  ManualPickBar: () => <div data-testid="manual-pick">Pick for member</div>,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let startMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
let readinessBody: Record<string, unknown>;

const launchReview = {
  advisorySha256: 'b'.repeat(64),
  requiresAcknowledgement: true,
  advisories: [
    {
      id: 'source_decisions',
      code: 'unresolved_source_decisions',
      affectedCount: 27,
      detail:
        '27 saved source questions remain unresolved. Starting does not resolve those questions.',
    },
    {
      id: 'qualification_holds',
      code: 'credential_import_dispute_requires_review',
      affectedCount: 2,
      detail:
        '2 credential assertions require review. Held credentials remain unavailable for eligibility and points.',
    },
  ],
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  startMock = vi.fn();
  readinessBody = { is_mock: true, readiness: null };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return startMock(url, init);
    return Response.json({ id: decodeURIComponent(url.split('/').at(-2) ?? ''), ...readinessBody });
  });
  vi.stubGlobal('fetch', fetchMock);
  refresh.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function showSetup(isMock = true, onStarted = refresh) {
  readinessBody.is_mock = isMock;
  await act(() =>
    root.render(
      <BidSessionSetup
        bidSessionId="saved mock / 7"
        isMock={isMock}
        memberCount={218}
        onStarted={onStarted}
      />,
    ),
  );
}
async function clickStart() {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Start Mock Bid',
  );
  if (!button) throw new Error('Start action missing');
  await act(() => button.click());
}

describe('Bid session setup', () => {
  it('previews the retained session without automatically starting or awarding anything', async () => {
    await showSetup();
    expect(host.textContent).toContain('Not started');
    expect(host.textContent).toContain('218 members');
    expect(host.textContent).toContain('saved rules retained');
    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Start Mock Bid',
    ]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/admin/bid-session/saved%20mock%20%2F%207/readiness',
      { credentials: 'include', cache: 'no-store' },
    );
    expect(startMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('starts only the exact Mock through the existing lifecycle endpoint, then refreshes', async () => {
    startMock.mockResolvedValue(Response.json({ ok: true }));
    await showSetup();
    await clickStart();
    expect(startMock).toHaveBeenCalledExactlyOnceWith(
      '/api/admin/bid-session/saved%20mock%20%2F%207/start',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Bid started');
    expect(host.querySelector('button')?.disabled).toBe(true);
  });

  it('suppresses duplicate Start clicks while the outcome is pending', async () => {
    let finish: (response: Response) => void = () => {};
    startMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    await showSetup();
    const button = host.querySelector('button');
    if (!button) throw new Error('Start action missing');
    await act(() => {
      button.click();
      button.click();
    });
    expect(startMock).toHaveBeenCalledOnce();
    await act(() => finish(Response.json({ ok: true })));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps the saved session and asks for normal sign-in when Start is rejected', async () => {
    startMock.mockResolvedValue(Response.json({ error: 'step_up_required' }, { status: 401 }));
    await showSetup();
    await clickStart();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Refresh operator sign-in');
    expect(startMock).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(host.querySelector('button')?.disabled).toBe(false);
  });

  it('starts Real through the same guarded lifecycle endpoint, with explicit Real wording and no separate settings detour', async () => {
    startMock.mockResolvedValue(Response.json({ ok: true }));
    await showSetup(false);
    expect(host.textContent).toContain('Real Bid');
    expect(host.querySelector('button')?.textContent).toBe('Start Real Bid');
    expect(host.querySelector('a')).toBeNull();
    expect(startMock).not.toHaveBeenCalled();
    await act(() => host.querySelector('button')?.click());
    expect(startMock).toHaveBeenCalledExactlyOnceWith(
      '/api/admin/bid-session/saved%20mock%20%2F%207/start',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('keeps Real source readiness errors visible and never treats rejection as a successful start', async () => {
    startMock.mockResolvedValue(
      Response.json({ error: 'live_readiness_blocked' }, { status: 409 }),
    );
    await showSetup(false);
    await act(() => host.querySelector('button')?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('live_readiness_blocked');
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'acknowledges 27 open questions and 2 credential holds with one action in Mock=%s',
    async (isMock) => {
      readinessBody.launchReview = launchReview;
      readinessBody.launchAcknowledged = false;
      startMock.mockResolvedValue(Response.json({ ok: true }));
      await showSetup(isMock);
      const details = host.querySelector('details');
      expect(details?.open).toBe(false);
      expect(details?.querySelector('summary')?.textContent).toBe('Launch advisories (2)');
      expect(host.querySelectorAll('li')).toHaveLength(2);
      expect(host.textContent).toContain('27 saved source questions');
      expect(host.textContent).toContain('2 credential assertions');
      expect(host.querySelector('input')).toBeNull();
      expect(host.querySelector('button')?.textContent).toBe('Start with advisories');
      expect(startMock).not.toHaveBeenCalled();
      await act(() => host.querySelector('button')?.click());
      expect(startMock).toHaveBeenCalledExactlyOnceWith(
        '/api/admin/bid-session/saved%20mock%20%2F%207/start',
        expect.objectContaining({
          body: JSON.stringify({
            launchAcknowledgement: { advisorySha256: launchReview.advisorySha256 },
          }),
        }),
      );
      expect(refresh).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])(
    'recognizes creation acknowledgement after reload without a second prompt in Mock=%s',
    async (isMock) => {
      readinessBody.launchReview = launchReview;
      readinessBody.launchAcknowledged = true;
      startMock.mockResolvedValue(Response.json({ ok: true }));
      await showSetup(isMock);
      expect(host.querySelector('summary')?.textContent).toBe(
        'Launch advisories (2) · acknowledged',
      );
      expect(host.querySelector('button')?.textContent).toBe(
        isMock ? 'Start Mock Bid' : 'Start Real Bid',
      );
      await act(() => host.querySelector('button')?.click());
      expect(startMock).toHaveBeenCalledOnce();
      expect(JSON.parse(String(startMock.mock.calls[0]?.[1]?.body))).toEqual({
        launchAcknowledgement: { advisorySha256: launchReview.advisorySha256 },
      });
      expect(refresh).toHaveBeenCalledOnce();
    },
  );

  it('requires a fresh acknowledgement if the server returns a changed digest', async () => {
    readinessBody.launchReview = launchReview;
    readinessBody.launchAcknowledged = true;
    const next = { ...launchReview, advisorySha256: 'c'.repeat(64) };
    startMock
      .mockResolvedValueOnce(
        Response.json({ error: 'launch_review_changed', launchReview: next }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await showSetup(false);
    await act(() => host.querySelector('button')?.click());
    expect(refresh).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'launch advisories changed',
    );
    expect(host.querySelector('button')?.textContent).toBe('Start with advisories');
    await act(() => host.querySelector('button')?.click());
    expect(JSON.parse(String(startMock.mock.calls[1]?.[1]?.body))).toEqual({
      launchAcknowledgement: { advisorySha256: next.advisorySha256 },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    { launchReview: { ...launchReview, advisorySha256: 'not-a-digest' } },
    { launchReview: { ...launchReview, requiresAcknowledgement: false } },
    { id: 'another-session' },
    { is_mock: false },
  ])('never enables Start for an unverified review: %j', async (invalid) => {
    await showSetup();
    await act(() => root.unmount());
    root = createRoot(host);
    Object.assign(readinessBody, invalid);
    // Render directly so an intentionally incorrect mode is not normalized by the helper.
    await act(() =>
      root.render(
        <BidSessionSetup
          bidSessionId="saved mock / 7"
          isMock
          memberCount={218}
          onStarted={refresh}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be verified');
    expect(host.querySelector('button')?.disabled).toBe(true);
    expect(startMock).not.toHaveBeenCalled();
  });
});

const shell = {
  bidSessionId: 'saved-mock',
  lastSeq: 0,
  currentPhase: 'config',
  currentBidderId: null,
  currentBidder: null,
  onDeck: [],
  bidOrder: [{ ordinal: 1, memberId: 17, pool: 'OFC' as const }],
  bidOrderPreview: true,
  sessionStartedAt: null,
  turnStartedAtMs: 0,
  turnTimerSeconds: 180,
  meMemberId: 17,
  initialFills: {},
  members: {},
  positions: [],
  wsBase: 'https://worker.invalid',
  isMock: true,
  mockControlRevision: 0,
  annual: null,
  advisory: null,
};

describe('Admin Bid setup routing', () => {
  it('shows the compact preview and Start for CONFIG even before annual runtime exists', async () => {
    await act(() => root.render(<AdminBidShell {...shell} />));
    expect(host.querySelector('[data-testid="workspace"]')?.getAttribute('data-preview')).toBe(
      'true',
    );
    expect(host.querySelector('[data-testid="bid-session-setup"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="manual-pick"]')).toBeNull();
    expect(host.querySelector('[data-testid="active-selection"]')).toBeNull();
    expect(host.querySelector('details')?.open).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('uses the existing current-bidder workspace after canonical Start', async () => {
    await act(() =>
      root.render(
        <AdminBidShell {...shell} currentPhase="position_bid" annual={{}} currentBidderId={17} />,
      ),
    );
    expect(host.querySelector('[data-testid="workspace"]')?.getAttribute('data-preview')).toBe(
      'false',
    );
    expect(host.querySelector('[data-testid="bid-session-setup"]')).toBeNull();
    expect(host.querySelector('[data-testid="active-selection"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="manual-pick"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
