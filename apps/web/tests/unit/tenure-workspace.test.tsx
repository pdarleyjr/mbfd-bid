// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TenureWorkspace } from '../../app/admin/personnel/tenure/TenureWorkspace';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../app/admin/annual-plan/annual-plan-client', async (original) => ({
  ...(await original<typeof import('../../app/admin/annual-plan/annual-plan-client')>()),
  annualGet: api.get,
  annualPost: api.post,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
let client: QueryClient;
let container: HTMLDivElement;
const date = '2027-01-01';
const people = [901, 902].map((id) => ({
  id,
  firstName: 'Synthetic',
  lastName: `Member ${id}`,
  employeeId: `SYNTHETIC-${id}`,
}));
const legacy = {
  id: 'synthetic-tenure',
  revision: 2,
  effectiveOn: date,
  status: 'UNPROTECTED',
  memberId: null,
  protectedFrom: null,
  protectedThrough: null,
  sourceRef: 'Synthetic historical evidence',
  reason: 'Synthetic review',
  actorSubject: 'synthetic-admin',
};

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(['admin', 'service-evidence', 'member-options'], people);
  client.setQueryData(['admin', 'current-roster', date], {
    positions: [{ id: 'synthetic-seat', stableSlotKey: 'Synthetic Days seat' }],
  });
  client.setQueryData(['admin', 'tenure', 'history', 'synthetic-seat'], { records: [legacy] });
  api.get.mockResolvedValue({ records: [legacy] });
  api.post.mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  client.clear();
  api.get.mockReset();
  api.post.mockReset();
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function field(label: string): HTMLInputElement | HTMLSelectElement {
  const controls = Array.from(container.querySelectorAll('input,select')) as unknown as Array<
    HTMLInputElement | HTMLSelectElement
  >;
  const found = controls.find((node) =>
    [...(node.labels ?? [])].some((entry) => entry.textContent?.trim().startsWith(label)),
  );
  if (!found) throw new Error(`Missing field ${label}`);
  return found;
}
async function change(label: string, value: string) {
  await settle(() => {
    const node = field(label);
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function toggle() {
  await settle(() => field('Record service and bid cycles').click());
}
async function submit() {
  await settle(() =>
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <TenureWorkspace />
      </QueryClientProvider>,
    ),
  );
  await change('Staffing date', date);
  await change('Authorized staffing seat', 'synthetic-seat');
}
async function baseEvidence(status = 'UNPROTECTED') {
  await change('Evidence effective date', date);
  await change('Reviewed status', status);
  await change('Authoritative source reference', 'Synthetic reviewed service ledger');
  await change('Review reason', 'Synthetic verified totals');
  if (status === 'PROTECTED') {
    await change('Protected member', '901');
    await change('Protected from', date);
    await change('Protected through (inclusive)', '2027-12-31');
  }
}

it('preserves legacy history and omits optional term facts from an ordinary tenure submission', async () => {
  await mount();
  expect(container.textContent).toContain('Service and bid-cycle evidence not recorded.');
  expect(api.post).not.toHaveBeenCalled();
  await baseEvidence();
  await submit();
  const body = api.post.mock.calls[0]?.[1];
  expect(body).toMatchObject({
    staffing_position_id: 'synthetic-seat',
    expected_revision: 2,
    status: 'UNPROTECTED',
  });
  expect(body).not.toHaveProperty('term_member_id');
  expect(body).not.toHaveProperty('accumulated_service_months');
  expect(body).not.toHaveProperty('consecutive_bid_cycles');
});

it('starts facts blank, rejects incomplete or mismatched holders, and sends all three reviewed facts together', async () => {
  await mount();
  await baseEvidence('PROTECTED');
  await toggle();
  expect(field('Reviewed service and cycle holder').value).toBe('');
  expect(field('Accumulated service months').value).toBe('');
  expect(field('Consecutive bid cycles').value).toBe('');
  await submit();
  expect(api.post).not.toHaveBeenCalled();
  await change('Reviewed service and cycle holder', '902');
  await change('Accumulated service months', '36');
  await change('Consecutive bid cycles', '3');
  await submit();
  expect(api.post).not.toHaveBeenCalled();
  expect(container.textContent).toContain('must match the protected member');
  await change('Reviewed service and cycle holder', '901');
  await submit();
  expect(api.post).toHaveBeenCalledExactlyOnceWith(
    'tenure-evidence',
    expect.objectContaining({
      member_id: 901,
      term_member_id: 901,
      accumulated_service_months: 36,
      consecutive_bid_cycles: 3,
      effective_on: date,
      source_ref: 'Synthetic reviewed service ledger',
      reason: 'Synthetic verified totals',
    }),
    expect.stringMatching(/^[0-9a-f-]{36}$/i),
  );
});

it('accepts explicit zero counts and preserves the exact request and retry key after a lost response', async () => {
  api.post.mockRejectedValueOnce(new Error('Synthetic lost response')).mockResolvedValueOnce({});
  await mount();
  await baseEvidence();
  await toggle();
  await change('Reviewed service and cycle holder', '901');
  await change('Accumulated service months', '0');
  await change('Consecutive bid cycles', '0');
  await submit();
  expect(field('Accumulated service months').value).toBe('0');
  expect(field('Consecutive bid cycles').value).toBe('0');
  expect(container.textContent).toContain('Synthetic lost response');
  await submit();
  expect(api.post.mock.calls).toHaveLength(2);
  expect(api.post.mock.calls[1]).toStrictEqual(api.post.mock.calls[0]);
  expect(api.post.mock.calls[0]?.[1]).toMatchObject({
    term_member_id: 901,
    accumulated_service_months: 0,
    consecutive_bid_cycles: 0,
  });
  expect((field('Record service and bid cycles') as HTMLInputElement).checked).toBe(false);
});

it('displays service and cycles independently and marks incomplete history instead of inventing zeroes', async () => {
  client.setQueryData(['admin', 'tenure', 'history', 'synthetic-seat'], {
    records: [
      legacy,
      {
        ...legacy,
        id: 'synthetic-complete',
        revision: 3,
        termMemberId: 901,
        accumulatedServiceMonths: 36,
        consecutiveBidCycles: 2,
      },
      {
        ...legacy,
        id: 'synthetic-incomplete',
        revision: 4,
        termMemberId: 902,
        accumulatedServiceMonths: null,
        consecutiveBidCycles: 1,
      },
    ],
  });
  await mount();
  expect(container.textContent).toContain(
    '36 accumulated service months · 2 consecutive bid cycles',
  );
  expect(container.textContent).toContain(
    'Service and bid-cycle evidence is incomplete and requires review.',
  );
  expect(container.textContent).toContain('Service and bid-cycle evidence not recorded.');
  expect(api.post).not.toHaveBeenCalled();
});
