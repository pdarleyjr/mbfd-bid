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

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  refresh.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function showSetup(isMock = true, onStarted = refresh) {
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
    expect(host.textContent).toContain('preview their details and previous bid');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('starts only the exact Mock through the existing lifecycle endpoint, then refreshes', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await showSetup();
    await clickStart();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/admin/bid-session/saved%20mock%20%2F%207/start',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Mock started');
    expect(host.querySelector('button')?.disabled).toBe(true);
  });

  it('suppresses duplicate Start clicks while the outcome is pending', async () => {
    let finish: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
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
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(() => finish(Response.json({ ok: true })));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps the saved session and asks for normal sign-in when Start is rejected', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'step_up_required' }, { status: 401 }));
    await showSetup();
    await clickStart();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Sign in again');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(host.querySelector('button')?.disabled).toBe(false);
  });

  it('never offers the Mock start action for a Real session', async () => {
    await showSetup(false);
    expect(host.textContent).toContain('Real Bid');
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/sessions/saved%20mock%20%2F%207',
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(fetchMock).not.toHaveBeenCalled();
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
