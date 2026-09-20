// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BidEvidenceWorkspace } from '../../app/admin/personnel/bid-evidence/BidEvidenceWorkspace';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../app/admin/annual-plan/annual-plan-client', () => ({
  annualGet: api.get,
  annualPost: api.post,
}));
vi.mock('../../app/admin/current-bid/BidFields', () => ({
  useBidMembers: () => ({ data: [{ value: '901', label: 'Synthetic Member' }] }),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
async function settle(action = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function control(label: string) {
  const value = [...container.querySelectorAll('input,select')].find((element) =>
    [...((element as HTMLInputElement).labels ?? [])].some((item) =>
      item.textContent?.trim().startsWith(label),
    ),
  ) as HTMLInputElement | HTMLSelectElement | undefined;
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
async function field(label: string, value: string) {
  const element = control(label);
  await settle(() => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function button(label: string) {
  const value = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
async function mount() {
  await settle(() =>
    root.render(
      <QueryClientProvider client={client}>
        <BidEvidenceWorkspace initialMemberId="901" />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(api.get).toHaveBeenCalledWith('bid-tour-evidence/901');
  });
}
async function upload(value: unknown) {
  const input = control('Reviewed ordinal mapping');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ text: async () => JSON.stringify(value) }],
  });
  await settle(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}
const mapping = {
  bidYear: new Date().getFullYear(),
  expectedRevision: 0,
  sourceSha256: 'a'.repeat(64),
  sourceRef: 'SYNTHETIC reviewed workbook',
  reason: 'Reviewed stable employee identity',
  entries: [{ memberId: 901, employeeId: 'SYNTHETIC-901', timeInGrade: 7, departmentService: 12 }],
};
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockImplementation(async (path: string) =>
    path.startsWith('bid-ordinals') ? { dataset: null } : { records: [] },
  );
  api.post.mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

it('requires a reviewed unique mapping and explicit save, preserving retry identity after response loss', async () => {
  await mount();
  await upload({ ...mapping, entries: [...mapping.entries, ...mapping.entries] });
  expect(container.textContent).toContain('unique identities');
  expect(api.post).not.toHaveBeenCalled();
  await upload(mapping);
  expect(container.textContent).toContain(mapping.sourceSha256);
  expect(api.post).not.toHaveBeenCalled();
  api.post.mockRejectedValueOnce(new Error('Response lost'));
  await settle(() => button('Save reviewed Bid ordinals').click());
  expect(container.textContent).toContain('Response lost');
  await settle(() => button('Save reviewed Bid ordinals').click());
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls[1]).toEqual(api.post.mock.calls[0]);
  expect(api.post.mock.calls[0]?.slice(0, 2)).toEqual(['bid-ordinals', mapping]);
});

it('blocks a stale import and a mismatched year without rewriting its source revision', async () => {
  api.get.mockImplementation(async (path: string) =>
    path.startsWith('bid-ordinals')
      ? { dataset: { revision: 2, entries: [], sourceRef: 'Newer reviewed source' } }
      : { records: [] },
  );
  await mount();
  await upload(mapping);
  expect(button('Save reviewed Bid ordinals').disabled).toBe(true);
  await upload({ ...mapping, bidYear: mapping.bidYear + 1 });
  expect(container.textContent).toContain('differs from the selected year');
  expect(api.post).not.toHaveBeenCalled();
});

it('discards a file read completed after changing the Bid year', async () => {
  await mount();
  let finish: ((value: string) => void) | undefined;
  const input = control('Reviewed ordinal mapping');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [
      {
        text: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      },
    ],
  });
  await settle(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  await field('Bid year', String(mapping.bidYear + 1));
  await settle(() => finish?.(JSON.stringify(mapping)));
  expect(container.textContent).not.toContain(mapping.sourceSha256);
  expect(
    [...container.querySelectorAll('button')].some(
      (item) => item.textContent === 'Save reviewed Bid ordinals',
    ),
  ).toBe(false);
  expect(api.post).not.toHaveBeenCalled();
});

it('requires renewed review when tour evidence changes while a draft is open', async () => {
  await mount();
  await field('Effective date', '2026-09-19');
  await field('Source reference', 'SYNTHETIC reviewed record');
  await field('Reason', 'Reviewed complete evidence');
  await field('Reviewed finding', 'no');
  await settle(() => {
    client.setQueryData(['admin', 'bid-tour-evidence', '901'], {
      records: [
        {
          id: 'newer',
          revision: 1,
          effectiveOn: '2026-09-18',
          completedDaysTour: 1,
          sourceRef: 'SYNTHETIC concurrent review',
        },
      ],
    });
  });
  expect(container.textContent).toContain('changed while this review was open');
  expect(button('Save reviewed tour evidence').disabled).toBe(true);
  await settle(() => button('Save reviewed tour evidence').click());
  expect(api.post).not.toHaveBeenCalled();
  await settle(() => button('Discard draft and review latest tour evidence').click());
  expect(control('Effective date').value).toBe('');
  await field('Effective date', '2026-09-19');
  await field('Source reference', 'SYNTHETIC reviewed correction');
  await field('Reason', 'Reviewed newer evidence');
  await field('Reviewed finding', 'yes');
  await settle(() => button('Save reviewed tour evidence').click());
  expect(api.post).toHaveBeenCalledWith(
    'bid-tour-evidence',
    expect.objectContaining({ expectedRevision: 1, completedDaysTour: true }),
    expect.any(String),
  );
});

it.each([
  ['unknown', null],
  ['no', false],
  ['yes', true],
] as const)(
  'retains the distinct %s tour finding and reviewed identity',
  async (finding, expected) => {
    await mount();
    await field('Effective date', '2026-09-19');
    await field('Source reference', 'SYNTHETIC reviewed tour records');
    await field('Reason', 'Reviewed complete tour evidence');
    await field('Reviewed finding', finding);
    expect(api.post).not.toHaveBeenCalled();
    await settle(() => button('Save reviewed tour evidence').click());
    expect(api.post).toHaveBeenCalledWith(
      'bid-tour-evidence',
      expect.objectContaining({ memberId: 901, expectedRevision: 0, completedDaysTour: expected }),
      expect.any(String),
    );
  },
);
