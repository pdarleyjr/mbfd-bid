// @vitest-environment jsdom
import type { SyntheticSpecialtyStateSignal } from '@mbfd/shared';
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

function Harness({
  onSyntheticSpecialtyState,
}: {
  onSyntheticSpecialtyState?: (signal: SyntheticSpecialtyStateSignal) => void;
}) {
  const store = useMemo(
    () => createBidStore({ bidSessionId: 'session-1', initialSeq: 9, meMemberId: 7 }),
    [],
  );
  const { status } = useBidWebSocket(store, {
    bidSessionId: 'session-1',
    wsBase: 'https://api.staging.bid.mbfdhub.com',
    onSyntheticSpecialtyState,
  });
  return <output data-testid="status">{status}</output>;
}

const completeSyntheticSpecialtyStateSignal = {
  v: 1,
  type: 'synthetic_specialty_state_changed',
  mode: 'synthetic_test_only',
  does_not_commit_bid: true,
  bidSessionId: 'session-1',
  revision: 4,
  controlState: {
    rehearsalRevision: 9,
    normalTurn: {
      turnId: 'mock-normal:session-1:9:1:0:17',
      bidderId: 17,
      ordinal: 1,
      queueCursor: 0,
      mockControlRevision: 9,
    },
    normalBidderSuspended: true,
    specialty: {
      active: true,
      requestId: 'synthetic-request-1',
      positionId: 'A101',
      phase: 'resolving_higher_priority_candidates',
      originalTurn: {
        turnId: 'mock-normal:session-1:9:1:0:17',
        bidderId: 17,
        ordinal: 1,
        queueCursor: 0,
        mockControlRevision: 9,
      },
      candidateQueue: [{ memberId: 11, priorityRank: 1 }],
      candidateCursor: 0,
      resolvedCandidateCount: 0,
      resolution: null,
      allowedNextAction: 'resolve_candidate',
    },
  },
} satisfies SyntheticSpecialtyStateSignal;

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

  it('delivers a complete synthetic specialty state signal to the caller without treating it as a normal Bid event', async () => {
    const onSyntheticSpecialtyState = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Harness onSyntheticSpecialtyState={onSyntheticSpecialtyState} />);
    });
    await settle();

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify(completeSyntheticSpecialtyStateSignal),
      } as MessageEvent);
    });

    expect(onSyntheticSpecialtyState).toHaveBeenCalledTimes(1);
    expect(onSyntheticSpecialtyState).toHaveBeenCalledWith(completeSyntheticSpecialtyStateSignal);
  });
});
