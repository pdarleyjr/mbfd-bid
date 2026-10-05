// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionMeta, Shift } from '../../app/_components/bid/types';
import { AdminBoard } from '../../app/admin/bid/_components/AdminBoard';

const actions = vi.hoisted(() => ({
  choosePosition: vi.fn(),
  selectMember: vi.fn(),
  submitPick: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../app/bid/_hooks/useBidWebSocket', () => ({
  useBidWebSocket: () => ({ status: 'open' }),
}));
vi.mock('../../app/admin/bid/_components/BidOperatorContext', () => ({
  useBidOperator: () => ({
    selectedMemberId: 1,
    choosePosition: actions.choosePosition,
    selectMember: actions.selectMember,
  }),
}));
vi.mock('../../app/admin/bid/_components/ManualPickContext', () => ({
  useManualPick: () => ({ pickMode: false, selectedMemberId: 1, submitPick: actions.submitPick }),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const ordinary: PositionMeta = {
  id: 'A101',
  shift: 'A',
  station: 'Station #1',
  unit: 'Combat 1',
  rankRequired: 'CPT',
  positionName: 'Captain',
  bidParticipation: 'BIDDABLE',
};
const assigned = ['A211', 'B211', 'C211', 'A801', 'D201', 'D301', 'D401', 'D402'].map(
  (id, index) => ({
    ...ordinary,
    id,
    shift: id[0] as Shift,
    bidParticipation:
      index < 4 ? ('ADMIN_ASSIGNED_NON_BIDDABLE' as const) : ('RESERVED_NON_BIDDABLE' as const),
    readOnlyAssignment: { memberId: index + 10, name: `Fixed ${index} Member`, rank: 'CPT' },
  }),
);
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function show(shift?: Shift) {
  await act(async () =>
    root.render(
      <AdminBoard
        bidSessionId="fixed-display"
        initialSeq={1}
        meMemberId={1}
        initialCurrentBidderId={1}
        initialFills={{ A102: { memberId: 2, ordinal: 2, bidId: 'existing-award' } }}
        members={{
          '1': {
            id: 1,
            firstName: 'Current',
            lastName: 'Bidder',
            rank: 'CPT',
            employeeId: 'PRIVATE1',
          },
          '2': {
            id: 2,
            firstName: 'Selected',
            lastName: 'Member',
            rank: 'CPT',
            employeeId: 'PRIVATE2',
          },
        }}
        positions={[
          ordinary,
          { ...ordinary, id: 'A102' },
          ...assigned,
          { ...ordinary, id: 'D499', shift: 'D', bidParticipation: 'RESERVED_NON_BIDDABLE' },
        ]}
        advisory={null}
        managed
        workspace
        selectedShift={shift}
      />,
    ),
  );
}

describe('assigned seats in the operator board', () => {
  it.each([
    ['A', 2],
    ['B', 1],
    ['C', 1],
    ['D', 4],
  ] as const)('shows fixed %s occupants as read-only Assigned cards', async (shift, count) => {
    await show(shift);
    const cards = container.querySelectorAll('[data-testid^="assigned-position-"]');
    expect(cards).toHaveLength(count);
    expect([...cards].every((card) => card.textContent?.includes('Assigned'))).toBe(true);
    expect(container.querySelector('[data-testid="assigned-position-D499"]')).toBeNull();
    for (const card of cards) {
      expect(card.tagName).toBe('DIV');
      expect(card.querySelector('button,a,input')).toBeNull();
      await act(async () => (card as HTMLElement).click());
    }
    expect(actions.choosePosition).not.toHaveBeenCalled();
    expect(actions.selectMember).not.toHaveBeenCalled();
    expect(actions.submitPick).not.toHaveBeenCalled();
  });
  it('keeps ordinary open and occupied seat behavior unchanged', async () => {
    await show('A');
    expect(container.querySelectorAll('[data-testid^="position-cell-"]')).toHaveLength(2);
    await act(async () =>
      (container.querySelector('[data-testid="position-cell-A101"]') as HTMLElement).click(),
    );
    expect(actions.choosePosition).toHaveBeenCalledWith('A101');
    await act(async () =>
      (container.querySelector('[data-testid="position-cell-A102"]') as HTMLElement).click(),
    );
    expect(actions.selectMember).toHaveBeenCalledWith(2);
    expect(actions.submitPick).not.toHaveBeenCalled();
  });
  it('follows the shift tabs when the parent does not control the selected shift', async () => {
    await show();
    expect(container.querySelector('[data-testid="assigned-position-A211"]')).not.toBeNull();
    await act(async () => (container.querySelector('#shift-tab-D') as HTMLElement).click());
    expect(container.querySelectorAll('[data-testid^="assigned-position-"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="assigned-position-A211"]')).toBeNull();
  });
});
