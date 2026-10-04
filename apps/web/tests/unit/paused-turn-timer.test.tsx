// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCommandBar } from '../../app/admin/bid/_components/LiveCommandBar';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let container: HTMLDivElement;
const started = Date.UTC(2026, 9, 3, 20);
const pausedAt = started + 60_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(pausedAt);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  document.body.replaceChildren();
});
async function render(
  isMock: boolean,
  phase = 'paused',
  pausedAtMs: number | null = pausedAt,
  turnStart = started,
) {
  await act(async () =>
    root.render(
      <LiveCommandBar
        bidSessionId="saved-synthetic"
        isMock={isMock}
        lastSeq={4}
        currentPhase={phase}
        sessionStartedAt={started}
        turnStartedAtMs={turnStart}
        turnPausedAtMs={pausedAtMs}
        turnTimerSeconds={180}
        currentBidder={null}
        currentBidderId={17}
        onDeck={[]}
        managed
      />,
    ),
  );
}
describe('saved pause turn timer', () => {
  it.each([true, false])(
    'holds the same remaining turn for days and resumes the saved time for Mock mode %s',
    async (isMock) => {
      await render(isMock);
      const turn = () => container.querySelector('[data-testid="turn-remaining"]');
      expect(turn()?.textContent).toBe('2:00 · Paused');
      expect(turn()?.getAttribute('data-urgency')).toBe('normal');
      const later = pausedAt + 2 * 86_400_000;
      vi.setSystemTime(later);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(turn()?.textContent).toBe('2:00 · Paused');
      const resumedAt = Date.now();
      await render(isMock, 'position_bid', null, started + resumedAt - pausedAt);
      expect(turn()?.textContent).toBe('2:00');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(turn()?.textContent).toBe('1:59');
    },
  );
  it('labels a legacy paused session as Paused instead of displaying an expired countdown', async () => {
    vi.setSystemTime(pausedAt + 86_400_000);
    await render(true, 'paused', null);
    expect(container.querySelector('[data-testid="turn-remaining"]')?.textContent).toBe('Paused');
  });
});
