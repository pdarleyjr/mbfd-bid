// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectBid } from '../../app/admin/bid/_components/CorrectBid';

vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section>{children}</section> : null,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let failConfirm: boolean;
let failReload: boolean;
const commands: Record<string, unknown>[] = [];
const source = {
  bidId: 'award-1',
  originalCommandId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  originalADayCommandId: null,
  originalPositionId: 'one',
  memberId: 17,
  status: 'ACTIVE',
  aDay: 'G1',
  membershipIds: [],
  eligiblePositionIds: ['one', 'two'],
  termParticipation: null,
};
const readback = {
  sequence: 4,
  sealed: false,
  sources: [source],
  positions: [
    { id: 'one', label: 'A 1 Engine Firefighter', shift: 'A' },
    { id: 'two', label: 'A 2 Rescue Firefighter', shift: 'A' },
  ],
  combatGroups: ['G1', 'G2', 'G3', 'G4'],
  opportunityPools: [],
};
const preview = {
  valid: true,
  expectedSeq: 4,
  before: { positionId: 'one', fill: { memberId: 17, aDay: 'G1' }, aDay: null },
  after: { positionId: 'one', fill: { memberId: 17, aDay: 'G2' } },
  reason: 'Recorded wrong A-Day',
  memberId: 17,
  constraintEffects: [
    { group: 'A:G1', before: 1, after: 0 },
    { group: 'A:G2', before: 0, after: 1 },
  ],
  validated: ['Eligibility', 'A-Day limits'],
};

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button missing: ${text}`);
  await act(async () => {
    button.click();
  });
}
async function change(id: string, value: string) {
  const input = container.querySelector(`#${id}`) as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (!input) throw new Error(`Input missing: ${id}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  failConfirm = false;
  failReload = false;
  commands.length = 0;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/csrf')
      return Response.json({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    if (url.endsWith('/corrections/preview')) return Response.json(preview);
    if (url.endsWith('/commands/live')) {
      commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (failConfirm) {
        failConfirm = false;
        throw new Error('Synthetic network loss');
      }
      return Response.json({ kind: 'accepted', seq: 5 });
    }
    if (failReload && commands.length > 0) {
      failReload = false;
      throw new Error('Synthetic refresh loss');
    }
    return Response.json(readback);
  });
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => {
    root.render(
      <CorrectBid
        bidSessionId="synthetic-correction"
        members={{
          '17': {
            id: 17,
            rank: 'FF',
            firstName: 'Synthetic',
            lastName: 'Member',
            employeeId: 'synthetic-17',
          },
        }}
      />,
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('guided audited correction', () => {
  it('loads original receipt automatically and requires reason and server preview before confirmation', async () => {
    await click('Correct a bid');
    expect(container.textContent).toContain('Synthetic Member');
    expect(container.textContent).not.toContain('Confirm correction');
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    expect(container.textContent).toContain('BEFORE');
    expect(container.textContent).toContain('AFTER');
    expect(container.textContent).toContain('Recorded wrong A-Day');
    expect(container.textContent).toContain('A:G1');
    expect(commands).toHaveLength(0);
    await click('Confirm correction');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'live.correct_bid',
      originalCommandId: source.originalCommandId,
      originalBidId: source.bidId,
      expectedSeq: 4,
      replacement: { positionId: 'one', aDay: 'G2' },
    });
  });

  it('retries the exact reviewed command after uncertain delivery', async () => {
    await click('Correct a bid');
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    failConfirm = true;
    await click('Confirm correction');
    expect(container.textContent).toContain('retry');
    await click('Confirm correction');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
  });

  it('requires a new server review after the operator edits the draft or refreshes awards', async () => {
    await click('Correct a bid');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    expect(container.textContent).toContain('Confirm correction');
    await change('correction-a-day', 'G3');
    expect(container.textContent).not.toContain('Confirm correction');
    expect(commands).toHaveLength(0);
    await click('Review correction');
    await click('Refresh awards');
    expect(container.textContent).not.toContain('Confirm correction');
    expect(commands).toHaveLength(0);
  });

  it('preserves accepted acknowledgement and blocks another correction until failed readback is refreshed', async () => {
    await click('Correct a bid');
    await change('correction-reason', 'Recorded wrong A-Day');
    await change('correction-a-day', 'G2');
    await click('Review correction');
    failReload = true;
    await click('Confirm correction');
    expect(commands).toHaveLength(1);
    expect(container.textContent).toContain('Correction recorded');
    expect(container.textContent).not.toContain('Delivery is uncertain');
    expect(container.textContent).not.toContain('Confirm correction');
    const reviewButton = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Review correction'),
    );
    expect(reviewButton?.disabled).toBe(true);
    await click('Refresh awards');
    expect(reviewButton?.disabled).toBe(false);
    expect(commands).toHaveLength(1);
  });
});
