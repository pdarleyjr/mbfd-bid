// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Presentation, PresentationView } from '../../app/live/PresentationView';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

const projection = (sequence: number, name: string, session = 'mock-a'): Presentation => ({
  mode: 'LIVE',
  sequence,
  session: { id: session, bid_year: 2026, is_mock: true },
  current_bidder: { member_id: sequence, name, rank: 'FF' },
  phase: 'position_bid',
  progress: { filled: sequence, total: 223 },
  positions: [],
});

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

async function poll(milliseconds = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<PresentationView initial={projection(10, 'Initial bidder')} />),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Department presentation refresh', () => {
  it('serializes delayed polls and preserves the current session sequence through stale readback', async () => {
    let resolveDelayed!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveDelayed = resolve;
        }),
    );
    fetchMock.mockResolvedValueOnce(Response.json(projection(11, 'Older bidder')));
    fetchMock.mockResolvedValueOnce(Response.json(projection(13, 'Recovered bidder')));
    await poll();
    await poll(4000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolveDelayed(Response.json(projection(12, 'Latest bidder'))));
    expect(container.textContent).toContain('Latest bidder');
    await poll();
    expect(container.textContent).toContain('Latest bidder');
    expect(container.textContent).not.toContain('Older bidder');
    expect(container.textContent).toContain('Waiting for current updates');
    expect(container.textContent).not.toContain('LIVE DISPLAY');
    await poll();
    expect(container.textContent).toContain('Recovered bidder');
    expect(container.textContent).toContain('LIVE DISPLAY');
  });

  it('shows failed refreshes without losing the board and recovers a same-sequence HOLD projection', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Synthetic connection failure'));
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ...projection(10, 'Initial bidder'),
        mode: 'HOLD',
        held_at_sequence: 7,
      }),
    );
    await poll();
    expect(container.textContent).toContain('Initial bidder');
    expect(container.textContent).toContain('Updates disconnected');
    expect(container.textContent).not.toContain('LIVE DISPLAY');
    await poll();
    expect(container.textContent).toContain('DISPLAY HELD · SEQ 7');
    expect(container.textContent).not.toContain('Updates disconnected');
  });

  it('accepts a new session and OFF mode without applying the previous session sequence floor', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(projection(1, 'New session bidder', 'mock-b')));
    fetchMock.mockResolvedValueOnce(Response.json({ mode: 'OFF', session: null }));
    fetchMock.mockResolvedValueOnce(
      Response.json(projection(1, 'Another session bidder', 'mock-c')),
    );
    await poll();
    expect(container.textContent).toContain('New session bidder');
    await poll();
    expect(container.textContent).toContain('Presentation is off');
    await poll();
    expect(container.textContent).toContain('Another session bidder');
    expect(container.textContent).toContain('LIVE DISPLAY');
  });

  it('marks a rejected HTTP response as disconnected and aborts an unfinished poll on unmount', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    await poll();
    expect(container.textContent).toContain('Updates disconnected');
    await poll();
    const signal = fetchMock.mock.calls[1]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    root = createRoot(container);
  });

  it('aborts a stalled request at ten seconds and recovers on the next poll', async () => {
    let requestSignal!: AbortSignal;
    fetchMock.mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          requestSignal = options.signal;
          requestSignal.addEventListener('abort', () => reject(new Error('Synthetic timeout')));
        }),
    );
    fetchMock.mockResolvedValueOnce(Response.json(projection(11, 'After timeout')));
    await poll();
    await poll(9999);
    expect(requestSignal.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await poll(1);
    expect(requestSignal.aborted).toBe(true);
    expect(container.textContent).toContain('Updates disconnected');
    await poll();
    expect(container.textContent).toContain('After timeout');
    expect(container.textContent).toContain('LIVE DISPLAY');
  });

  it('retains the known sequence when the same-session readback omits sequence evidence', async () => {
    const incomplete = { ...projection(11, 'Unverified bidder'), sequence: undefined };
    fetchMock.mockResolvedValueOnce(Response.json(incomplete));
    await poll();
    expect(container.textContent).toContain('Initial bidder');
    expect(container.textContent).not.toContain('Unverified bidder');
    expect(container.textContent).toContain('Waiting for current updates');
  });
});
