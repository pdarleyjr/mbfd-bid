// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorPositionCell } from '../../app/_components/bid/OperatorPositionCell';
import { RichPositionCell } from '../../app/_components/bid/RichPositionCell';
import type { MemberLite, PositionMeta } from '../../app/_components/bid/types';
import { BidStoreProvider } from '../../app/bid/_hooks/BidStoreContext';
import { type Fill, createBidStore } from '../../app/bid/_hooks/useBidStore';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const position: PositionMeta = {
  id: 'A102',
  shift: 'A',
  station: '1',
  unit: 'Combat 1',
  rankRequired: 'LT',
  positionName: 'Lieutenant',
};
const members: Record<string, MemberLite> = {
  '1': {
    id: 1,
    employeeId: 'synthetic-1',
    firstName: 'Synthetic',
    lastName: 'Firefighter',
    rank: 'FF',
  },
};
const fill: Fill = {
  memberId: 1,
  ordinal: 1,
  bidId: 'canonical-award',
  aDay: 'G3',
  forced: { commandId: 'canonical-force', actorMemberId: 99, reason: 'Chief directed', atMs: 1 },
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});
async function mount(node: ReactNode) {
  await act(() => root.render(node));
}
function requiredElement<T extends Element>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

describe.each([OperatorPositionCell, RichPositionCell])('shared seat appearance %s', (Cell) => {
  it('retains the submitting state with readable text over the role color', async () => {
    const store = createBidStore({ bidSessionId: 'synthetic-mode', initialSeq: 1, meMemberId: 99 });
    store.getState().markPendingMine('A102', 'pending-key');
    await mount(
      <BidStoreProvider store={store}>
        <Cell position={position} members={members} />
      </BidStoreProvider>,
    );
    const row = requiredElement<HTMLElement>('[data-testid="position-cell-A102"]');
    expect(row.dataset.state).toBe('pending-mine');
    expect(row.textContent).toContain('Submitting…');
    expect(row.style.backgroundColor).toBe('rgb(252, 165, 165)');
    expect(host.querySelector('[data-testid="forced-marker-A102"]')).toBeNull();
  });

  it('uses the seat role for an open seat and preserves its click action', async () => {
    const click = vi.fn();
    await mount(<Cell position={position} members={members} onClick={click} />);
    const row = requiredElement<HTMLButtonElement>('[data-testid="position-cell-A102"]');
    expect(row.dataset.state).toBe('open');
    expect(row.dataset.seatRole).toBe('lieutenant');
    expect(row.style.backgroundColor).toBe('rgb(252, 165, 165)');
    expect(row.textContent).toContain('Open');
    expect(host.querySelector('[data-testid="forced-marker-A102"]')).toBeNull();
    await act(() => row.click());
    expect(click).toHaveBeenCalledWith('A102');
  });
  it('keeps the Lieutenant seat color for a forced firefighter and accessible ! details', async () => {
    const store = createBidStore({ bidSessionId: 'synthetic-mode', initialSeq: 1, meMemberId: 99 });
    store.setState({ fills: { A102: fill } });
    const click = vi.fn();
    await mount(
      <BidStoreProvider store={store}>
        <Cell position={position} members={members} onClick={click} />
      </BidStoreProvider>,
    );
    const row = requiredElement<HTMLButtonElement>('[data-testid="position-cell-A102"]');
    const marker = requiredElement('[data-testid="forced-marker-A102"]');
    expect(row.dataset.state).toBe('filled');
    expect(row.dataset.seatRole).toBe('lieutenant');
    expect(row.textContent).toContain('FF Synthetic Firefighter');
    expect(marker.textContent).toBe('!');
    expect(marker.getAttribute('aria-label')).toBe('Forced assignment: Chief directed');
    expect(marker.getAttribute('title')).toBe('Forced assignment: Chief directed');
    await act(() => row.click());
    expect(click).toHaveBeenCalledWith('A102');
  });
  it('does not mark an ordinary or A-day override selection as forced', async () => {
    const store = createBidStore({ bidSessionId: 'synthetic-mode', initialSeq: 1, meMemberId: 99 });
    const { forced: _ignored, ...ordinary } = fill;
    store.setState({
      fills: {
        A102: {
          ...ordinary,
          aDayOverride: {
            commandId: 'override',
            actorMemberId: 99,
            reason: '',
            positionId: 'A102',
            aDay: 'G3',
            warningCodes: [],
          },
        },
      },
    });
    await mount(
      <BidStoreProvider store={store}>
        <Cell position={position} members={members} />
      </BidStoreProvider>,
    );
    expect(host.querySelector('[data-testid="forced-marker-A102"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="position-cell-A102"]')?.getAttribute('data-state'),
    ).toBe('filled');
  });
});
