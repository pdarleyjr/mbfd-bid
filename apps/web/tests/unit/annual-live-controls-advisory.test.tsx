// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  originalWindowFetch = window.fetch;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname !== '/api/admin/bid-session/specialty-advisory/specialty-live')
      throw new Error(`Unexpected request: ${url.pathname}`);
    return response({
      sequence: 4,
      current_bidder: null,
      remaining_order: [],
      fills: {},
      specialties: [],
      active: null,
      specialty_coverage: {
        availability: 'AVAILABLE',
        source: 'FROZEN_SESSION_SNAPSHOT',
        status: 'AT_RISK',
        total_specialty_seat_count: 2,
        filled_specialty_seat_count: 1,
        remaining_specialty_seat_count: 1,
        maximum_remaining_covered_count: 1,
        guaranteed_uncovered_seat_count: 0,
        critical_member_ids: [17],
      },
    });
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
  await settle(() =>
    root?.render(
      <AnnualLiveControls
        bidSessionId="specialty-advisory"
        isMock={false}
        currentBidderId={null}
        bidOrder={[]}
        fills={{}}
        members={{}}
        positions={[]}
      />,
    ),
  );
}

describe('AnnualLiveControls specialty coverage advisory', () => {
  it('surfaces frozen coverage facts as explicitly read-only, non-blocking operator context', async () => {
    await mount();

    await vi.waitFor(async () => {
      await settle();
      expect(container.textContent).toContain('Specialty coverage advisory');
    });

    expect(container.textContent).toContain('AT RISK');
    expect(container.textContent).toContain('1 of 2 specialty seats filled');
    expect(container.textContent).toContain(
      '1 frozen candidate is critical to the remaining coverage',
    );
    expect(container.textContent).toContain(
      'Read-only advisory from the frozen session snapshot and canonical fills. It does not approve, block, or change an operator action.',
    );
    expect(
      [...container.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    ).not.toContain('Resolve specialty coverage');
  });

  it('makes unsupported frozen coverage material visibly unavailable without changing controls', async () => {
    const fetcher = vi.fn(async () =>
      response({
        sequence: 4,
        current_bidder: null,
        remaining_order: [],
        fills: {},
        specialties: [],
        active: null,
        specialty_coverage: {
          availability: 'UNAVAILABLE',
          source: 'FROZEN_SESSION_SNAPSHOT',
          code: 'SPECIALTY_COVERAGE_AMBIGUOUS_POSITION',
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    window.fetch = fetcher;
    await mount();

    await vi.waitFor(async () => {
      await settle();
      expect(container.textContent).toContain('Frozen specialty coverage is unavailable');
    });

    expect(container.textContent).toContain('SPECIALTY_COVERAGE_AMBIGUOUS_POSITION');
    expect(container.textContent).toContain(
      'Read-only advisory from the frozen session snapshot and canonical fills. It does not approve, block, or change an operator action.',
    );
    expect(
      [...container.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    ).not.toContain('Resolve specialty coverage');
  });
});
