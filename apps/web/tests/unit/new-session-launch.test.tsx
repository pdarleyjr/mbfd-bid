// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NewSessionForm } from '../../app/admin/sessions/new/NewSessionForm';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/client-csrf', () => ({ createCsrfAwareFetch: (fetcher: typeof fetch) => fetcher }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const year = new Date().getFullYear();
const review = {
  advisorySha256: 'a'.repeat(64),
  requiresAcknowledgement: true,
  advisories: [
    {
      id: 'source_decisions',
      code: 'unresolved_source_decisions',
      affectedCount: 27,
      detail: '27 unresolved source questions stay open.',
    },
    {
      id: 'qualification_holds',
      code: 'credential_import_dispute_requires_review',
      affectedCount: 2,
      detail: '2 held credentials remain unavailable for eligibility and points.',
    },
  ],
};
let host: HTMLDivElement;
let root: Root;
let calls: Array<{ path: string; body: Record<string, unknown> }>;
let failPreview: string | null;
let validMode: boolean;
let failCreate: string | null;
let advisory: boolean;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  calls = [];
  failPreview = null;
  failCreate = null;
  validMode = true;
  advisory = true;
  push.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ path, body });
      if (path.endsWith('/readiness-preview')) {
        if (failPreview)
          return Response.json({ error: failPreview, dry_run: true, would_allow_start: false });
        return Response.json({
          dry_run: true,
          bid_year: body.bid_year,
          mode: validMode ? body.mode : 'another-mode',
          is_mock: body.mode === 'mock',
          would_allow_start: true,
          readiness: null,
          launchReview: advisory
            ? review
            : { ...review, requiresAcknowledgement: false, advisories: [] },
        });
      }
      if (failCreate) return Response.json({ error: failCreate }, { status: 403 });
      return Response.json(
        {
          id: 'synthetic session / 3',
          current_phase: 'config',
          is_mock: body.mode === 'mock',
          launchReview: review,
          launchAcknowledged: true,
        },
        { status: 201 },
      );
    }),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(isMock = true) {
  await act(() => root.render(<NewSessionForm defaultMock={isMock} />));
}
async function create() {
  await act(() => host.querySelector('button')?.click());
}

it.each([true, false])(
  'uses the same exact advisory acknowledgement for unmanaged Mock=%s',
  async (isMock) => {
    await mount(isMock);
    expect(calls).toEqual([
      {
        path: '/api/admin/bid-session/readiness-preview',
        body: { bid_year: year, mode: isMock ? 'mock' : 'live' },
      },
    ]);
    expect(host.querySelector('details')?.open).toBe(false);
    expect(host.textContent).toContain('27 open source questions · 2 held credentials');
    expect(host.querySelector('button')?.textContent).toBe(
      isMock ? 'Create Mock with advisories' : 'Create Real with advisories',
    );
    await create();
    expect(calls[1]).toEqual({
      path: '/api/admin/bid-session',
      body: {
        bid_year: year,
        mode: isMock ? 'mock' : 'live',
        launchAcknowledgement: { advisorySha256: review.advisorySha256 },
      },
    });
    expect(push).toHaveBeenCalledExactlyOnceWith(
      '/admin/bid?session_id=synthetic%20session%20%2F%203',
    );
    expect(calls).toHaveLength(2);
  },
);

it.each([true, false])(
  'creates directly without an acknowledgement when Mock=%s has no advisories',
  async (isMock) => {
    advisory = false;
    await mount(isMock);
    expect(host.querySelector('details')).toBeNull();
    expect(host.querySelector('button')?.textContent).toBe(
      isMock ? 'Create Mock Bid' : 'Create Real Bid',
    );
    await create();
    expect(calls[1]?.body).toEqual({ bid_year: year, mode: isMock ? 'mock' : 'live' });
  },
);

it('routes managed years to their normal saved Bid entry without creating a parallel session', async () => {
  failPreview = 'managed_bid_version_required';
  await mount();
  expect(host.querySelector('a')?.textContent).toBe('Open Current Bid');
  expect(host.querySelector('a')?.getAttribute('href')).toBe(`/admin/current-bid?year=${year}`);
  expect(host.querySelector('button')).toBeNull();
  expect(calls).toHaveLength(1);
});

it('keeps a hard snapshot error visible and cannot create a session', async () => {
  failPreview = 'session_policy_snapshot_unavailable';
  await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'session policy snapshot unavailable',
  );
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(calls).toHaveLength(1);
});

it('rejects a review for another mode', async () => {
  validMode = false;
  await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be verified');
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(calls).toHaveLength(1);
});

it('does not treat a permission failure as a created session', async () => {
  failCreate = 'live_action_forbidden';
  await mount(false);
  await create();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('live action forbidden');
  expect(push).not.toHaveBeenCalled();
});
