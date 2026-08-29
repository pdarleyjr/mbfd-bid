// @vitest-environment jsdom
import { act, useMemo } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBidStore } from '../../app/bid/_hooks/useBidStore';
import { useBidWebSocket } from '../../app/bid/_hooks/useBidWebSocket';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(
    readonly url: string,
    readonly protocols: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }
}

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

function Harness() {
  const store = useMemo(
    () => createBidStore({ bidSessionId: 'session-1', initialSeq: 9, meMemberId: 7 }),
    [],
  );
  const { status } = useBidWebSocket(store, {
    bidSessionId: 'session-1',
    wsBase: 'https://api.staging.bid.mbfdhub.com',
  });
  return <output data-testid="status">{status}</output>;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useBidWebSocket ticket protocol', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ticket: 'opaque-ticket' }), { status: 200 })),
    );
  });

  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('obtains a same-origin opaque ticket, sends it only as a WebSocket subprotocol, and never sends a JWT in the URL or hello frame', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Harness />);
    });
    await settle();

    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/ws-ticket',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: 'session-1' }),
      }),
    );
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(socket?.url).toBe('wss://api.staging.bid.mbfdhub.com/api/ws/session/session-1');
    expect(socket?.url).not.toContain('token=');
    expect(socket?.protocols).toEqual(['mbfd-bid-v1', 'opaque-ticket']);

    await act(async () => {
      socket?.open();
    });
    expect(socket?.sent).toEqual([JSON.stringify({ type: 'hello', lastSeq: 9 })]);
  });
});
