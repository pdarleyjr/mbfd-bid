// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YourTurnPanel } from '../../app/bid/_components/YourTurnPanel';
import { createBidStore } from '../../app/bid/_hooks/useBidStore';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
});

function renderPanel(props: {
  connectionStatus: 'connecting' | 'open' | 'closed';
  send: (message: object) => boolean;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const store = createBidStore({ bidSessionId: 'session-1', initialSeq: 0, meMemberId: 1 });
  store.setState({ currentBidderId: 1 });

  act(() => {
    root.render(
      <YourTurnPanel
        store={store}
        send={props.send}
        connectionStatus={props.connectionStatus}
        eligiblePositionIds={['A101']}
      />,
    );
  });

  return { container, store };
}

describe('YourTurnPanel connection safety', () => {
  it('does not send or mark a pick pending while reconnecting', () => {
    const send = vi.fn(() => true);
    const { container, store } = renderPanel({ connectionStatus: 'closed', send });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="eligible-position-A101"]',
    );
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain('No pick was sent');

    act(() => button?.click());

    expect(send).not.toHaveBeenCalled();
    expect(store.getState().pendingMine).toEqual({});
  });

  it('does not create optimistic pending state when the socket cannot send', () => {
    const send = vi.fn(() => false);
    const { container, store } = renderPanel({ connectionStatus: 'open', send });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="eligible-position-A101"]',
    );
    act(() => button?.click());

    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getState().pendingMine).toEqual({});
    expect(container.textContent).toContain('could not be sent');
  });

  it('marks the position pending only after the socket accepts the command', () => {
    const send = vi.fn(() => true);
    const { container, store } = renderPanel({ connectionStatus: 'open', send });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="eligible-position-A101"]',
    );
    act(() => button?.click());

    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getState().pendingMine.A101).toEqual(expect.any(String));
    expect(container.textContent).toContain('submitting');
  });
});
