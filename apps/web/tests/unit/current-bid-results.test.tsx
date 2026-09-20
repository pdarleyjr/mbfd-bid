// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidResults } from '../../app/admin/current-bid/BidResults';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;
let requests: Array<{ url: string; method: string }>;
let responseFor: (url: string) => Promise<Response>;
const rows = [
  { id: 'live-synthetic', isMock: 0, currentPhase: 'position_bid', startedAt: 1 },
  { id: 'mock-synthetic', isMock: 1, currentPhase: 'config', startedAt: 2 },
];
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function result(id = 'live-synthetic', isMock = false) {
  return {
    session: { id, bidYear: 2027, isMock, currentPhase: 'complete', sequence: 31 },
    awardSource: 'CANONICAL',
    provenance: {
      valid: true,
      error: null,
      pin: {
        v: 1,
        bidSessionId: id,
        bidYear: 2027,
        versionId: 'synthetic-version-4',
        versionSha256: 'a'.repeat(64),
        contextSha256: 'b'.repeat(64),
      },
      ruleBookVersion: 'synthetic-rules',
      topologyReference: 'synthetic-topology',
    },
    awards: [
      {
        memberId: 17,
        name: isMock ? 'Synthetic Mock Member' : 'Synthetic Live Member',
        positionId: 'synthetic-seat',
        positionName: 'Synthetic opportunity',
        shift: 'A',
        station: '7',
        unit: 'Synthetic Engine',
        aDay: 'G2',
      },
    ],
    completion: { verified: !isMock, blockers: isMock ? ['mock_session_not_transitionable'] : [] },
  };
}
beforeEach(() => {
  originalWindowFetch = window.fetch;
  requests = [];
  responseFor = async (url) => {
    if (url === '/api/admin/annual-plan/2027')
      return response({ plan: { year: 2027, sessions: rows } });
    if (url === '/api/admin/bid-session/live-synthetic/results') return response(result());
    if (url === '/api/admin/bid-session/mock-synthetic/results')
      return response(result('mock-synthetic', true));
    throw new Error(`Unexpected request ${url}`);
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET' });
    return responseFor(String(input));
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.fetch = originalWindowFetch;
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() => root?.render(<BidResults year={2027} />));
}
async function selectRun(id: string) {
  await settle(() => {
    const node = container.querySelector(
      'select[aria-label="Bid run"]',
    ) as unknown as HTMLSelectElement;
    node.value = id;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Current Bid read-only results', () => {
  it('labels a pool award and frozen memberships while retaining the concrete slot provenance', async () => {
    const original = responseFor;
    responseFor = async (url) =>
      url.endsWith('/live-synthetic/results')
        ? response({
            ...result(),
            awards: [
              {
                ...result().awards[0],
                pool: {
                  id: 'pool',
                  label: 'Synthetic station capacity',
                  kind: 'STATION_POOL',
                  sourceRef: 'Synthetic source',
                  sourceDecisionId: 'decision',
                },
                memberships: [{ id: 'overlay', label: 'Synthetic reviewed membership' }],
              },
            ],
          })
        : original(url);
    await mount();
    await selectRun('live-synthetic');
    expect(container.textContent).toContain('Synthetic station capacity');
    expect(container.textContent).toContain('Synthetic reviewed membership');
    expect(container.textContent).toContain('synthetic-seat');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(requests.every((entry) => entry.method === 'GET')).toBe(true);
  });

  it('requires an explicit run, then displays canonical awards, frozen provenance and selected-run links', async () => {
    await mount();
    expect(requests).toEqual([{ url: '/api/admin/annual-plan/2027', method: 'GET' }]);
    expect(container.textContent).not.toContain('Synthetic Live Member');
    await selectRun('live-synthetic');
    expect(container.textContent).toContain('Live Bid · live-synthetic');
    expect(container.textContent).toContain('Phase: complete · Sequence 31');
    expect(container.textContent).toContain('Official completion verified.');
    expect(container.textContent).toContain('Synthetic Live Member');
    expect(container.textContent).toContain('synthetic-version-4');
    expect(container.textContent).toContain('synthetic-topology');
    expect(container.textContent).toContain('G2');
    expect([...container.querySelectorAll('a')].map((node) => node.getAttribute('href'))).toEqual([
      '/admin/exports?session_id=live-synthetic',
      '/admin/audit?bid_session_id=live-synthetic',
      '/admin/award-transition?session_id=live-synthetic',
    ]);
    expect(requests.every((entry) => entry.method === 'GET')).toBe(true);
  });

  it('visibly separates Mock evidence and prevents links to a production transition', async () => {
    await mount();
    await selectRun('mock-synthetic');
    expect(container.textContent).toContain('Mock rehearsal · mock-synthetic');
    expect(container.textContent).toContain('Mock runs cannot become Department assignments.');
    expect(container.textContent).toContain('Synthetic Mock Member');
    expect([...container.querySelectorAll('a')].map((node) => node.getAttribute('href'))).toEqual([
      '/admin/exports?session_id=mock-synthetic',
      '/admin/audit?bid_session_id=mock-synthetic',
    ]);
    expect(container.textContent).not.toContain('Official completion verified.');
  });

  it('preserves server blockers and makes missing historical canonical awards explicit', async () => {
    const original = responseFor;
    responseFor = async (url) =>
      url.endsWith('/live-synthetic/results')
        ? response({
            ...result(),
            awardSource: 'CANONICAL_UNAVAILABLE',
            awards: [],
            completion: { verified: false, blockers: ['FINAL_A_DAY_MISSING'] },
          })
        : original(url);
    await mount();
    await selectRun('live-synthetic');
    expect(container.textContent).toContain('A final A-Day selection is missing.');
    expect(container.textContent).toContain(
      'Canonical awards are unavailable for this historical run.',
    );
    expect(container.textContent).not.toContain('No awards have been recorded.');
  });

  it('rejects results belonging to another run or year without showing their awards', async () => {
    const original = responseFor;
    responseFor = async (url) =>
      url.endsWith('/live-synthetic/results')
        ? response({ ...result(), session: { ...result().session, bidYear: 2026 } })
        : original(url);
    await mount();
    await selectRun('live-synthetic');
    expect(container.textContent).toContain('Results do not match the selected run.');
    expect(container.textContent).not.toContain('Synthetic Live Member');
  });

  it('ignores an old in-flight result after selecting a different run', async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    const original = responseFor;
    responseFor = async (url) =>
      url.endsWith('/live-synthetic/results')
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : original(url);
    await mount();
    await selectRun('live-synthetic');
    await selectRun('mock-synthetic');
    await settle(() => resolveOld?.(response(result())));
    expect(container.textContent).toContain('Synthetic Mock Member');
    expect(container.textContent).not.toContain('Synthetic Live Member');
    expect(requests.every((entry) => entry.method === 'GET')).toBe(true);
  });

  it('shows empty and failed run listing states without fetching or creating a run', async () => {
    responseFor = async () => response({ plan: { year: 2027, sessions: [] } });
    await mount();
    expect(container.textContent).toContain('No runs are available for 2027.');
    responseFor = async () => response({ error: 'synthetic_service_unavailable' }, 503);
    await settle(() =>
      [...container.querySelectorAll('button')]
        .find((node) => node.textContent === 'Refresh results')
        ?.click(),
    );
    expect(container.textContent).toContain(
      'Run listing unavailable: synthetic_service_unavailable',
    );
    expect(requests).toHaveLength(2);
    expect(requests.every((entry) => entry.method === 'GET')).toBe(true);
  });
});
