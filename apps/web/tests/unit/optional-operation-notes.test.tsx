// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreezeConfirmDialog } from '../../app/admin/bid/_components/FreezeConfirmDialog';
import { LiveCommandBar } from '../../app/admin/bid/_components/LiveCommandBar';
import { MockFreezeButton } from '../../app/admin/bid/_components/MockFreezeButton';
import { OverrideDialog } from '../../app/admin/bid/_components/OverrideDialog';
import { RuleBookCreateForm } from '../../app/admin/rule-books/RuleBookCreateForm';

vi.mock('@/components/ui/dialog', () => ({
  ConfirmationDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let container: HTMLDivElement;
let root: Root;
let writes: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST')
        writes.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return Response.json({ ok: true, version: 'synthetic-2088' });
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(children: ReactNode) {
  await act(async () => root.render(children));
}
async function change(selector: string, value: string) {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input: ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(selector: string) {
  const button = container.querySelector(selector);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`);
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

describe('optional bid-operation notes in confirmation forms', () => {
  it.each(['', null])('submits an empty skip note and preserves Cancel (%s)', async (note) => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(note));
    await mount(
      <LiveCommandBar
        bidSessionId="synthetic-session"
        currentPhase="position_bid"
        sessionStartedAt={null}
        turnStartedAtMs={null}
        turnTimerSeconds={180}
        currentBidder={null}
        currentBidderId={17}
        onDeck={[]}
        isMock={false}
        lastSeq={7}
      />,
    );
    await click('[data-testid="admin-action-skip"]');
    if (note === null) expect(writes).toHaveLength(0);
    else expect(writes[0]?.body).toMatchObject({ bidSessionId: 'synthetic-session', reason: '' });
  });
  it('forces a legacy selection with an empty note while retaining selected identities', async () => {
    await mount(<OverrideDialog bidSessionId="synthetic-session" onClose={vi.fn()} />);
    await change('[data-testid="override-member-id"]', '17');
    await change('[data-testid="override-position-id"]', 'A101');
    expect(container.querySelector('textarea')?.required).toBe(false);
    await click('[data-testid="override-submit"]');
    expect(writes[0]?.body).toMatchObject({
      bidSessionId: 'synthetic-session',
      targetMemberId: 17,
      positionId: 'A101',
      reason: '',
    });
  });
  it.each([true, false])('pauses a session with an empty note (Mock %s)', async (isMock) => {
    if (isMock) {
      await mount(<MockFreezeButton bidSessionId="synthetic-mock" expectedSeq={7} />);
      await click('[data-testid="mock-freeze-action"]');
    } else {
      await mount(<FreezeConfirmDialog bidSessionId="synthetic-real" onClose={vi.fn()} />);
    }
    const note = container.querySelector('textarea');
    expect(note?.required).toBe(false);
    expect(note?.minLength).toBe(-1);
    if (isMock) {
      const button = [...container.querySelectorAll('button')].find(
        (button) => button.type === 'submit',
      );
      expect(button?.disabled).toBe(false);
      await act(async () => button?.click());
    } else {
      await click('[data-testid="freeze-submit"]');
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body.reason).toBe('');
    if (isMock) expect(writes[0]?.body.expectedSeq).toBe(7);
  });
  it('creates a Bid rule-book draft without a typed note while preserving its effective year', async () => {
    await mount(<RuleBookCreateForm ruleBooks={[]} />);
    const year = container.querySelector('input[type="number"]');
    if (!(year instanceof HTMLInputElement)) throw new Error('Missing effective year');
    await change('input[type="number"]', '2088');
    const form = container.querySelector('form');
    if (!form) throw new Error('Missing draft form');
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(writes[0]?.body).toMatchObject({ effective_year: 2088, reason: '' });
  });
});
