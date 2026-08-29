// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RosterClient } from '../../app/admin/members/roster/RosterClient';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const members = [
  {
    id: 7,
    employee_id: 'synthetic-007',
    last_name: 'Operator',
    first_name: 'Avery',
    rank: 'FF' as const,
    bid_category: 'FF' as const,
    rsc_seniority: 7,
    rank_seniority: 5,
    ordinal: 1,
    manual_override_ordinal: null,
    credential_ids: [],
  },
  {
    id: 8,
    employee_id: 'synthetic-008',
    last_name: 'Captain',
    first_name: 'Jordan',
    rank: 'CPT' as const,
    bid_category: 'OFC' as const,
    rsc_seniority: 8,
    rank_seniority: 4,
    ordinal: 2,
    manual_override_ordinal: null,
    credential_ids: [],
  },
];

function renderRoster(bidOrderSession?: { sessionId: string; label: string }): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <RosterClient
        initialMembers={members}
        credentials={[]}
        initialSearch=""
        bidOrderSession={bidOrderSession ?? null}
      />,
    );
  });
  return container;
}

describe('RosterClient bid-order context', () => {
  it('blocks reordering clearly when the active session cannot be verified', () => {
    const container = renderRoster();

    expect(container.textContent).toContain('Manual bid-order reordering is unavailable');
    expect(container.textContent).toContain('no active Bid session is verified');
    expect(container.querySelector('[data-testid="bid-order-session-context"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Move Operator down"]')?.disabled,
    ).toBe(true);
  });

  it('uses the verified active-session context internally while showing an operator-readable label', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ updated: 2 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const container = renderRoster({
      sessionId: 'opaque-session-7',
      label: '2026 rehearsal Bid · in progress',
    });

    expect(container.textContent).toContain('2026 rehearsal Bid · in progress');
    expect(container.textContent).not.toContain('Open this page with ?session_id=');

    const down = container.querySelector<HTMLButtonElement>('[aria-label="Move Operator down"]');
    if (!down) throw new Error('Roster move control did not render.');
    await act(async () => {
      down.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error('Reorder request did not include request options.');
    expect(JSON.parse(String(request.body))).toMatchObject({ session_id: 'opaque-session-7' });
  });
});
