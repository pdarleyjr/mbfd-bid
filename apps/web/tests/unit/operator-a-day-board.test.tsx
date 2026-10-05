// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PositionMeta } from '../../app/_components/bid/types';
import {
  BidOperatorProvider,
  useBidOperator,
} from '../../app/admin/bid/_components/BidOperatorContext';
import { OperatorADayBoard } from '../../app/admin/bid/_components/OperatorADayBoard';
import {
  type OperatorADayProjection,
  projectADayBoard,
} from '../../app/admin/bid/_components/operator-a-day-board';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const position: PositionMeta = {
  id: 'A101',
  shift: 'A',
  station: 'Station #1',
  unit: 'Combat 1',
  rankRequired: 'CPT',
  positionName: 'Captain',
};
const positions = [
  position,
  { ...position, id: 'A102' },
  { ...position, id: 'B101', shift: 'B' as const },
];
const projection: OperatorADayProjection = {
  sessionId: 'test-real-or-mock',
  sequence: 4,
  combatGroups: ['G1', 'G2'],
  maximumPerGroup: 1,
  fills: {
    A101: { member_id: 1, a_day: 'G1' },
    A102: { member_id: 2 },
    B101: { member_id: 3, a_day: 'G2' },
  },
};
const members = {
  '1': { id: 1, firstName: 'Saved', lastName: 'Member', rank: 'CPT', employeeId: '1' },
  '2': { id: 2, firstName: 'Pending', lastName: 'Member', rank: 'CPT', employeeId: '2' },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function Fixture({
  selected = 1,
  value = projection,
}: { selected?: number; value?: OperatorADayProjection }) {
  const operator = useBidOperator();
  useEffect(() => {
    operator?.setADayProjection(value);
    operator?.setOverrideAllowed(true);
    operator?.selectMember(selected);
  }, [
    operator?.setADayProjection,
    operator?.setOverrideAllowed,
    operator?.selectMember,
    selected,
    value,
  ]);
  return (
    <>
      <OperatorADayBoard
        sessionId="test-real-or-mock"
        shift="A"
        positions={positions}
        members={members}
      />
      <output data-testid="intent">{JSON.stringify(operator?.overrideIntent)}</output>
    </>
  );
}
async function render(selected = 1, value = projection) {
  await act(async () =>
    root.render(
      <BidOperatorProvider currentBidderId={selected}>
        <Fixture selected={selected} value={value} />
      </BidOperatorProvider>,
    ),
  );
}
describe('A-Day board', () => {
  it('uses saved fills, excludes other shifts and preserves unknown A-Days', () => {
    const board = projectADayBoard(projection, positions, 'A');
    expect(board.groups.map((group) => [group.id, group.taken.length, group.remaining])).toEqual([
      ['G1', 1, 0],
      ['G2', 0, 1],
    ]);
    expect(board.pending.map((seat) => seat.memberId)).toEqual([2]);
  });
  it('opens an existing member A-Day review without submitting or changing the saved fill', async () => {
    await render();
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Select this A-Day',
    );
    await act(async () => button?.click());
    expect(
      JSON.parse(container.querySelector('[data-testid="intent"]')?.textContent ?? 'null'),
    ).toMatchObject({ memberId: 1, positionId: 'A101', action: 'A_DAY', aDay: 'G2', shift: 'A' });
    expect(projection.fills.A101?.a_day).toBe('G1');
  });
  it('keeps a full group reviewable and pending members visible', async () => {
    await render(2);
    expect(container.textContent).toContain('0 available');
    expect(container.textContent).toContain('A-Day pending · 1');
    const full = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Review full group',
    );
    expect(full?.disabled).toBe(false);
    await act(async () => full?.click());
    expect(
      JSON.parse(container.querySelector('[data-testid="intent"]')?.textContent ?? 'null'),
    ).toMatchObject({ memberId: 2, positionId: 'A102', action: 'A_DAY', aDay: 'G1' });
  });
  it('starts an unassigned member award draft carrying the selected group', async () => {
    await render(9);
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Select this A-Day',
    );
    await act(async () => button?.click());
    expect(
      JSON.parse(container.querySelector('[data-testid="intent"]')?.textContent ?? 'null'),
    ).toMatchObject({ memberId: 9, action: 'AWARD', aDay: 'G2', shift: 'A' });
  });
  it('retains accepted unconfigured groups as saved overrides without claiming available capacity or enabling group selection', async () => {
    const value: OperatorADayProjection = {
      ...projection,
      fills: {
        ...projection.fills,
        A102: { member_id: 2, a_day: 'G4' },
      },
    };
    const before = JSON.stringify(value);
    const board = projectADayBoard(value, positions, 'A');
    expect(board.groups.map((group) => group.id)).toEqual(['G1', 'G2', 'G4']);
    expect(board.groups[2]).toMatchObject({
      id: 'G4',
      savedOverride: true,
      maximum: null,
      remaining: null,
      taken: [{ memberId: 2, aDay: 'G4', position: { id: 'A102' } }],
    });
    expect(board.pending).toEqual([]);
    await render(2, value);
    const group = container.querySelector('[aria-label="A-Day G4"]');
    expect(group?.textContent).toContain('Group 4 · Saved override');
    expect(group?.textContent).toContain('1 selected');
    expect(group?.textContent).not.toContain('available');
    expect(group?.textContent).not.toContain('Select this A-Day');
    expect(group?.querySelectorAll('button')).toHaveLength(1);
    await act(async () => group?.querySelector('button')?.click());
    expect(
      JSON.parse(container.querySelector('[data-testid="intent"]')?.textContent ?? 'null'),
    ).toMatchObject({ memberId: 2, positionId: 'A102', action: 'A_DAY', aDay: 'G4' });
    expect(JSON.stringify(value)).toBe(before);
  });
});
