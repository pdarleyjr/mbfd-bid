// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';

type OverrideProps = {
  sequence: number;
  commandsBlocked: boolean;
  onCanonicalChange: (minimumSequence: number) => Promise<void>;
};
let overrideProps: OverrideProps | null;
vi.mock('../../app/admin/bid/_components/AdministratorOverride', () => ({
  AdministratorOverride: (props: OverrideProps) => {
    overrideProps = props;
    return null;
  },
}));
vi.mock('../../app/admin/bid/_components/CorrectBid', () => ({ CorrectBid: () => null }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;
let nextReadback: (() => Promise<Response>) | null;
let readbackCount: number;
let parentRefresh: ReturnType<typeof vi.fn<() => void>>;
function response(sequence: number) {
  return new Response(
    JSON.stringify({
      sequence,
      current_bidder: null,
      remaining_order: [],
      fills: {},
      specialties: [],
      active: null,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
beforeEach(() => {
  originalWindowFetch = window.fetch;
  overrideProps = null;
  nextReadback = null;
  readbackCount = 0;
  parentRefresh = vi.fn<() => void>();
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (!String(input).endsWith('/specialty-live'))
      throw new Error(`Unexpected request: ${String(input)}`);
    readbackCount += 1;
    return nextReadback ? nextReadback() : response(4);
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
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
async function mount(isMock: boolean) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <AnnualLiveControls
        bidSessionId="isolated-refresh"
        isMock={isMock}
        currentBidderId={null}
        bidOrder={[]}
        fills={{}}
        members={{}}
        positions={[]}
        onCanonicalChange={parentRefresh}
      />,
    ),
  );
  expect(overrideProps?.sequence).toBe(4);
}

describe.each([false, true])(
  'canonical readback after an accepted adjustment (Mock=%s)',
  (isMock) => {
    it('awaits the verified sequence before resolving the adjustment refresh', async () => {
      await mount(isMock);
      let finishReadback: ((value: Response) => void) | undefined;
      nextReadback = () =>
        new Promise((resolve) => {
          finishReadback = resolve;
        });
      let resolved = false;
      const refresh = overrideProps?.onCanonicalChange(5).then(() => {
        resolved = true;
      });
      await settle();
      expect(resolved).toBe(false);
      expect(overrideProps?.sequence).toBe(4);
      await act(async () => {
        finishReadback?.(response(5));
        await refresh;
      });
      expect(resolved).toBe(true);
      expect(overrideProps?.sequence).toBe(5);
      expect(parentRefresh).toHaveBeenCalledOnce();
    });

    it('shares a slow poll and retries one fresh read when the accepted save needs a newer sequence', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      await mount(isMock);
      let finishPoll: ((value: Response) => void) | undefined;
      let finishFreshRead: ((value: Response) => void) | undefined;
      let request = 0;
      nextReadback = () =>
        new Promise<Response>((resolve) => {
          request += 1;
          if (request === 1) finishPoll = resolve;
          else finishFreshRead = resolve;
        });
      await act(async () => {
        vi.advanceTimersByTime(2500);
        await Promise.resolve();
      });
      expect(readbackCount).toBe(2);
      await act(async () => {
        vi.advanceTimersByTime(7500);
        await Promise.resolve();
      });
      expect(readbackCount).toBe(2);
      let resolved = false;
      const refresh = overrideProps?.onCanonicalChange(5).then(() => {
        resolved = true;
      });
      await settle();
      expect(readbackCount).toBe(2);
      await settle(() => finishPoll?.(response(4)));
      expect(readbackCount).toBe(3);
      expect(overrideProps?.sequence).toBe(4);
      expect(resolved).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(7500);
        await Promise.resolve();
      });
      expect(readbackCount).toBe(3);
      await act(async () => {
        finishFreshRead?.(response(5));
        await refresh;
      });
      expect(resolved).toBe(true);
      expect(overrideProps?.sequence).toBe(5);
      expect(parentRefresh).toHaveBeenCalledOnce();

      nextReadback = async () => response(4);
      await act(async () => {
        vi.advanceTimersByTime(2500);
        await Promise.resolve();
      });
      await settle();
      expect(readbackCount).toBe(4);
      expect(overrideProps?.sequence).toBe(5);
      expect(parentRefresh).toHaveBeenCalledOnce();
    });

    it('refreshes the parent once when an accepted replay is already at the loaded sequence', async () => {
      await mount(isMock);
      await act(async () => {
        await overrideProps?.onCanonicalChange(4);
      });
      expect(overrideProps?.sequence).toBe(4);
      expect(parentRefresh).toHaveBeenCalledOnce();
    });

    it('blocks further commands when readback fails without swallowing the refresh error', async () => {
      await mount(isMock);
      nextReadback = async () => {
        throw new Error('Synthetic readback unavailable.');
      };
      await act(async () => {
        await expect(overrideProps?.onCanonicalChange(5)).rejects.toThrow(
          'Synthetic readback unavailable.',
        );
      });
      expect(overrideProps?.sequence).toBe(4);
      expect(overrideProps?.commandsBlocked).toBe(true);
      expect(container.textContent).toContain('Bid updates are unavailable.');
      nextReadback = async () => response(5);
      await settle(() => {
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent?.includes('Retry bid updates'))
          ?.click();
      });
      expect(overrideProps?.sequence).toBe(5);
      expect(overrideProps?.commandsBlocked).toBe(false);
    });

    it('does not unlock the next adjustment from a readback older than the accepted save', async () => {
      await mount(isMock);
      nextReadback = async () => response(4);
      await act(async () => {
        await expect(overrideProps?.onCanonicalChange(5)).rejects.toThrow(
          'The saved bid update has not arrived.',
        );
      });
      expect(overrideProps?.sequence).toBe(4);
      expect(overrideProps?.commandsBlocked).toBe(true);
    });
  },
);
