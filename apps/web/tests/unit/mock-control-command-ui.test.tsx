// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import {
  ManualPickProvider,
  useManualPick,
} from '../../app/admin/bid/_components/ManualPickContext';
import { AutoBidButton } from '../../app/admin/rehearsal/_components/AutoBidButton';
import { CloseStaleMockButton } from '../../app/admin/rehearsal/_components/CloseStaleMockButton';

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
  refresh.mockReset();
  vi.unstubAllGlobals();
});

function render(element: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('mock rehearsal command UI', () => {
  it('closes a stale legacy mock through the audited application endpoint', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ state: 'complete', idempotent: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const container = render(<CloseStaleMockButton sessionId="legacy-mock-1" />);
    const button = container.querySelector('button');
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Close stale mock button did not render.');

    await click(button);

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/rehearsal/legacy-mock-1/close-mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        reason: 'Staging remediation: close stale legacy mock before controlled rehearsal.',
      }),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('audit history retained');
  });

  it('retries auto-bid with its original idempotency key and control revision after a transport failure', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (_input, _init) => {
        if (fetchMock.mock.calls.length === 1) throw new Error('network unavailable');
        return new Response(
          JSON.stringify({
            picksMade: 1,
            stoppedReason: 'count_reached',
            mock_control_revision: 8,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: () => 'auto-command-key' });

    const container = render(
      <AutoBidButton
        sessionId="mock-session-1"
        strategy="first_eligible"
        count={1}
        mockControlRevision={7}
      />,
    );
    const button = container.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Auto-bid button did not render.');

    await click(button);
    expect(container.textContent).toContain('Connection failed');
    await click(button);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const retryHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get('Idempotency-Key')).toBe('auto-command-key');
    expect(retryHeaders.get('Idempotency-Key')).toBe('auto-command-key');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      count: 1,
      strategy: 'first_eligible',
      expected_mock_control_revision: 7,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Made 1 picks');
  });

  it('sends an idempotent, revision-bound manual pick to the mock-only endpoint', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ bid_id: 'bid-1', forced: false, mock_control_revision: 5 }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: () => 'manual-command-key' });

    function Probe() {
      const controls = useManualPick();
      return (
        <button
          type="button"
          onClick={() => {
            void controls.submitPick({ memberId: 60, positionId: 'A101' });
          }}
        >
          Submit mock pick
        </button>
      );
    }

    const container = render(
      <ManualPickProvider bidSessionId="mock-session-2" isMock mockControlRevision={4}>
        <Probe />
      </ManualPickProvider>,
    );
    const button = container.querySelector('button');
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Manual-pick probe did not render.');

    await click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/rehearsal/mock-session-2/manual-pick');
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Idempotency-Key')).toBe('manual-command-key');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      member_id: 60,
      position_id: 'A101',
      expected_mock_control_revision: 4,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
