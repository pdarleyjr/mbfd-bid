// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ServiceEvidenceWorkspace } from '../../app/admin/personnel/service-evidence/ServiceEvidenceWorkspace';
import ServiceEvidencePage from '../../app/admin/personnel/service-evidence/page';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('@/lib/require-admin', () => ({ requireAdmin: api.requireAdmin }));
vi.mock('../../app/admin/annual-plan/annual-plan-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/admin/annual-plan/annual-plan-client')>()),
  annualGet: api.get,
  annualPost: api.post,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  api.get.mockReset();
  api.post.mockReset();
  api.requireAdmin.mockReset();
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const linked = { id: 901, firstName: 'Synthetic', lastName: 'Linked', employeeId: 'SYNTHETIC-901' };
const other = { id: 1, firstName: 'Synthetic', lastName: 'Other', employeeId: 'SYNTHETIC-1' };
function sources() {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('members?')) return { members: [other, linked], total: 2 };
    if (path === 'service-evidence/types')
      return { types: [{ id: 'rescue', name: 'Synthetic rescue' }] };
    return { records: [] };
  });
  api.post.mockResolvedValue({});
}
async function render(initialMemberId?: number) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ServiceEvidenceWorkspace {...(initialMemberId === undefined ? {} : { initialMemberId })} />
      </QueryClientProvider>,
    ),
  );
  return container;
}

it('retains the linked identity while loading and resolves its actual member before reading history', async () => {
  let resolveMembers: ((result: { members: (typeof linked)[]; total: number }) => void) | undefined;
  sources();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('members?'))
      return new Promise((resolve) => {
        resolveMembers = resolve;
      });
    if (path === 'service-evidence/types') return { types: [] };
    return {
      records: [
        {
          id: 'evidence-901',
          memberId: 901,
          serviceCode: 'rescue',
          revision: 1,
          effectiveOn: '2026-09-01',
          verifiedMonths: 30,
          sourceRef: 'SYNTHETIC-SOURCE-901',
          reason: 'Reviewed source',
          actorSubject: 'synthetic-admin',
        },
      ],
    };
  });
  const container = await render(901);
  expect(container.textContent).toContain('Loading the member linked from Department');
  expect(container.querySelector('select')?.value).toBe('901');
  expect(container.querySelector('fieldset')?.disabled).toBe(true);
  expect(api.get.mock.calls.some(([path]) => String(path).startsWith('service-evidence?'))).toBe(
    false,
  );
  await settle(() => resolveMembers?.({ members: [other, linked], total: 2 }));
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain('SYNTHETIC-SOURCE-901');
    expect(container.querySelector('select')?.selectedOptions[0]?.textContent).toContain(
      'Synthetic Linked',
    );
  });
  expect(api.get).toHaveBeenCalledWith('service-evidence?member_id=901');
  expect(api.get).not.toHaveBeenCalledWith('service-evidence?member_id=1');
  expect(api.post).not.toHaveBeenCalled();
});

it('keeps legacy selection blank and exposes a missing linked member without using another identity', async () => {
  sources();
  const container = await render();
  expect(container.querySelector('select')?.value).toBe('');
  expect(api.get.mock.calls.some(([path]) => String(path).startsWith('service-evidence?'))).toBe(
    false,
  );
  act(() => root?.unmount());
  root = undefined;
  const missing = await render(999);
  await vi.waitFor(async () => {
    await settle();
    expect(missing.querySelector('[role="alert"]')?.textContent).toContain(
      'Member 999 was not found',
    );
  });
  expect(missing.querySelector('select')?.value).toBe('999');
  expect(missing.querySelector('fieldset')?.disabled).toBe(true);
  expect(api.get).not.toHaveBeenCalledWith('service-evidence?member_id=999');
  expect(api.post).not.toHaveBeenCalled();
});

it('checks every member-options page before reporting that the linked member is absent', async () => {
  sources();
  api.get.mockImplementation(async (path: string) => {
    if (path === 'members?limit=100&offset=0') return { members: [other], total: 2 };
    if (path === 'members?limit=100&offset=1') return { members: [linked], total: 2 };
    if (path === 'service-evidence/types') return { types: [] };
    return { records: [] };
  });
  const container = await render(901);
  await vi.waitFor(async () => {
    await settle();
    expect(container.querySelector('select')?.selectedOptions[0]?.textContent).toContain(
      'Synthetic Linked',
    );
  });
  expect(api.get).toHaveBeenCalledWith('members?limit=100&offset=1');
  expect(api.get).toHaveBeenCalledWith('service-evidence?member_id=901');
  expect(container.textContent).not.toContain('was not found');
});

it.each(['0', '-1', '1.5', 'bad', '9007199254740992', ['1', '2']])(
  'rejects malformed member links after the administrator guard: %s',
  async (memberId) => {
    const page = await ServiceEvidencePage({ searchParams: Promise.resolve({ memberId }) });
    expect(api.requireAdmin).toHaveBeenCalledOnce();
    expect(renderToStaticMarkup(page)).toContain('This member link is invalid');
    expect(api.get).not.toHaveBeenCalled();
  },
);

it('passes a valid protected member link into the workspace and preserves the default page', async () => {
  const selected = await ServiceEvidencePage({
    searchParams: Promise.resolve({ memberId: '901' }),
  });
  expect(selected.props.initialMemberId).toBe(901);
  const defaultPage = await ServiceEvidencePage({ searchParams: Promise.resolve({}) });
  expect(defaultPage.props.initialMemberId).toBeUndefined();
  api.requireAdmin.mockRejectedValueOnce(new Error('administrator required'));
  await expect(
    ServiceEvidencePage({ searchParams: Promise.resolve({ memberId: '901' }) }),
  ).rejects.toThrow('administrator required');
  expect(api.get).not.toHaveBeenCalled();
});
