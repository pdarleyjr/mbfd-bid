// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[2] === 'people'
      ? {
          data: {
            people: [
              {
                id: 1,
                firstName: 'Synthetic',
                lastName: 'Member',
                employeeId: 'TEST-1',
                employmentStatus: 'active',
                assignments: [],
              },
            ],
            pagination: { total: 1, totalPages: 1, hasNextPage: false },
          },
        }
      : { isPending: true },
}));

import { DepartmentPeopleWorkspace } from '../../app/admin/department/people/DepartmentPeopleWorkspace';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let container: HTMLDivElement;
function render() {
  root.render(<DepartmentPeopleWorkspace initialDate="2026-09-19" />);
}
function clickMember() {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label^="View member"]');
  if (!button) throw new Error('Synthetic member button missing');
  button.click();
}
function submitFilters() {
  const date = container.querySelector<HTMLInputElement>('input[name="as_of"]');
  const search = container.querySelector<HTMLInputElement>('input[name="q"]');
  const form = container.querySelector('form');
  if (!date || !search || !form) throw new Error('People filter form missing');
  date.value = '2026-09-12';
  search.value = 'TEST-1';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function lastParams() {
  const last = navigation.push.mock.calls.at(-1);
  if (!last) throw new Error('Expected navigation');
  return new URL(String(last[0]), 'https://synthetic.invalid').searchParams;
}

beforeEach(async () => {
  navigation.search = 'as_of=2026-09-19&page=2';
  navigation.push.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Department people navigation', () => {
  it('preserves submitted date and search on an immediate member click before router commit', async () => {
    await act(async () => {
      submitFilters();
      clickMember();
    });
    expect(navigation.push).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(lastParams())).toEqual({
      as_of: '2026-09-12',
      q: 'TEST-1',
      memberId: '1',
    });
  });

  it('keeps the latest intended filters when an earlier navigation commits', async () => {
    await act(async () => {
      submitFilters();
      clickMember();
    });
    navigation.search = 'as_of=2026-09-12&q=TEST-1';
    await act(async () => render());
    await act(async () => clickMember());
    expect(Object.fromEntries(lastParams())).toEqual({
      as_of: '2026-09-12',
      q: 'TEST-1',
      memberId: '1',
    });
  });

  it('uses external back/forward URL filters instead of retaining earlier intent', async () => {
    await act(async () => submitFilters());
    navigation.search = 'as_of=2026-10-01&q=other&employment_status=retired';
    await act(async () => render());
    await act(async () => clickMember());
    expect(Object.fromEntries(lastParams())).toEqual({
      as_of: '2026-10-01',
      q: 'other',
      employment_status: 'retired',
      memberId: '1',
    });
  });
});
