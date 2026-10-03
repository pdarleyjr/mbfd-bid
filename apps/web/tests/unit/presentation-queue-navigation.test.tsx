// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { type Presentation, PresentationView } from '../../app/live/PresentationView';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the paged member visible through queue measurement and follows the next current bidder', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('innerWidth', 1920);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  let queueHeight = 120;
  const observers: Array<{
    callback: ResizeObserverCallback;
    targets: Set<Element>;
    instance: ResizeObserver;
  }> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        observers.push({
          callback,
          targets: this.targets,
          instance: this as unknown as ResizeObserver,
        });
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const height = this.tagName === 'OL' ? queueHeight : 480;
    return {
      x: 0,
      y: 0,
      width: 300,
      height,
      top: 0,
      left: 0,
      right: 300,
      bottom: height,
      toJSON: () => ({}),
    };
  });
  const members = Array.from({ length: 12 }, (_, index) => ({
    member_id: index + 1,
    name: `Queue member ${index + 1}`,
    rank: 'FF',
  }));
  const view: Presentation = {
    mode: 'LIVE',
    sequence: 10,
    session: { id: 'isolated-queue', bid_year: 2026, is_mock: true },
    current_bidder: members[0] ?? null,
    on_deck: [members[1] ?? null],
    remaining_queue: members,
    positions: [],
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const shownMembers = () =>
    [...container.querySelectorAll('aside [data-testid="presentation-queue-member"] strong')].map(
      (element) => element.textContent,
    );
  try {
    await act(async () => root.render(<PresentationView initial={view} />));
    expect(shownMembers()).toEqual(['Queue member 1', 'Queue member 2']);
    await act(async () =>
      (
        container.querySelector('aside button[aria-label="Next bidders"]') as HTMLButtonElement
      ).click(),
    );
    expect(shownMembers()).toEqual(['Queue member 3', 'Queue member 4']);

    queueHeight = 60;
    await act(async () => {
      for (const observer of observers)
        if ([...observer.targets].some((element) => element.tagName === 'OL'))
          observer.callback([], observer.instance);
    });
    expect(shownMembers()).toEqual(['Queue member 3']);

    fetcher.mockResolvedValueOnce(
      Response.json({ ...view, sequence: 11, current_bidder: members[6] ?? null }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(shownMembers()).toEqual(['Queue member 7']);
    expect(container.querySelector('aside [aria-current="true"]')?.textContent).toContain(
      'Queue member 7',
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
