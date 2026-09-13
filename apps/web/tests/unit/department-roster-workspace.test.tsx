// @vitest-environment jsdom
import type { DepartmentRetirementImpact, DepartmentRosterProjection } from '@mbfd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: '', push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('@/lib/admin-projection-refresh', () => ({
  usePersonnelProjectionRefresh: () => mocks.refresh,
}));
vi.mock('../../app/admin/organization/OrganizationWorkspace', () => ({
  OrganizationWorkspace: ({
    initialDate,
    onMutationLocked,
  }: { initialDate?: string; onMutationLocked?: (locked: boolean) => void }) => (
    <div>
      <span data-testid="organization-workspace">Organization date {initialDate}</span>
      <button type="button" onClick={() => onMutationLocked?.(true)}>
        Edit organization draft
      </button>
      <button type="button" onClick={() => onMutationLocked?.(false)}>
        Clear organization draft
      </button>
    </div>
  ),
}));

import { DepartmentRosterWorkspace } from '../../app/admin/department/roster/DepartmentRosterWorkspace';
import { StaffingStructureWorkspace } from '../../app/admin/staffing-structure/StaffingStructureWorkspace';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const DATE = '2026-09-12';
const roster: DepartmentRosterProjection = {
  asOf: DATE,
  updatedAt: null,
  organizationUnits: [],
  positions: [
    {
      id: 'synthetic-seat',
      stableSlotKey: 'SYNTHETIC/E/SEAT',
      shift: 'E',
      station: 'Station Seven',
      unit: 'Engine Seven',
      division: 'Suppression',
      positionName: 'Synthetic Firefighter',
      applicableRank: 'FF',
      reviewStatus: 'approved',
      occupancy: 'vacant',
      assignment: null,
      member: null,
      temporaryContext: [],
    },
  ],
  summary: { totalPositions: 1, occupiedPositions: 0, vacantPositions: 1 },
  unassignedMembers: [
    {
      id: 77,
      employeeId: 'synthetic-77',
      firstName: 'Synthetic',
      lastName: 'Unassigned',
      rank: 'FF',
    },
  ],
};
function impact(effectiveOn = DATE): DepartmentRetirementImpact {
  return {
    target: {
      kind: 'POSITION',
      id: 'synthetic-seat',
      name: 'Synthetic Firefighter',
      stableSlotKey: 'SYNTHETIC/E/SEAT',
      authorization: {
        reviewStatus: 'approved',
        activeFrom: '2026-01-01',
        activeTo: null,
        updatedAt: 1,
      },
    },
    effectiveOn,
    lastActiveOn: '2026-09-11',
    retirementBlocked: false,
    blockers: [],
    assignments: [],
    organizationVersions: [],
    organizationLinks: [],
    retainsHistory: true,
  };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
type Sent = { path: string; key: string | null; payload: Record<string, unknown> };
function fetcher(handler: (sent: Sent) => Promise<Response> | Response) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/auth/csrf')
      return response({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    if (path.startsWith('/api/admin/department/current-roster?')) return response(roster);
    const item = {
      path,
      key: new Headers(init?.headers).get('Idempotency-Key'),
      payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    sent.push(item);
    return handler(item);
  });
  vi.stubGlobal('fetch', fetch);
  return { sent, fetch };
}

let root: Root | undefined;
let client: QueryClient;
beforeEach(() => {
  mocks.search = '';
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.refresh.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  client?.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(department = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <QueryClientProvider client={client}>
        {department ? (
          <DepartmentRosterWorkspace initialDate={DATE} />
        ) : (
          <StaffingStructureWorkspace roster={roster} />
        )}
      </QueryClientProvider>,
    ),
  );
  return container;
}
function button(name: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (control) => control.textContent?.trim() === name,
  );
  if (!found) throw new Error(`Button missing: ${name}`);
  return found;
}
function field(name: string) {
  const found = [...document.querySelectorAll('label')]
    .find((label) => {
      const text = label.cloneNode(true) as HTMLElement;
      for (const control of text.querySelectorAll('input,textarea,select,datalist'))
        control.remove();
      return text.textContent?.trim() === name;
    })
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  if (!found) throw new Error(`Field missing: ${name}`);
  return found;
}
async function fill(name: string, value: string) {
  const input = field(name);
  await settle(() => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function openRetirement() {
  await settle(() => button('Retire seat').click());
  await fill('Retirement reason', 'Synthetic approved retirement');
}

describe('Department roster and staffing retirement', () => {
  it('reads policy-free staffing, keeps real unassigned identities, and exposes a dated organization tab', async () => {
    const api = fetcher(() => {
      throw new Error('Read-only view attempted a command');
    });
    await mount(true);
    await vi.waitFor(async () => {
      await settle();
      expect(document.body.textContent).toContain('Synthetic Unassigned');
    });
    expect(api.fetch.mock.calls.map(([path]) => String(path))).toEqual([
      `/api/admin/department/current-roster?as_of=${DATE}`,
    ]);
    expect([...document.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toContain(
      `/admin/department?memberId=77&as_of=${DATE}`,
    );
    expect(document.querySelector(`a[href="/admin/department?as_of=${DATE}"]`)).not.toBeNull();
    expect(document.body.textContent).not.toContain('Administrative / non-biddable');
    expect(field('Shift').value).toBe('E');
    expect(field('Shift').maxLength).toBe(32);
    expect(document.querySelector('h2#staffing-structure-heading')?.textContent).toBe(
      'Positions and assignments',
    );
    expect(document.body.textContent).not.toContain('Station Station Seven');
    await fill('Staffing as of', '2026-10-01');
    await settle(() =>
      field('Staffing as of')
        .closest('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(mocks.push).toHaveBeenCalledWith('/admin/department/roster?as_of=2026-10-01', {
      scroll: false,
    });
    await settle(() => button('Organization').click());
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/department/roster?view=organization', {
      scroll: false,
    });
  });

  it('reuses OrganizationWorkspace at the requested date without fetching annual roster metadata', async () => {
    mocks.search = 'view=organization&as_of=2026-11-01';
    const api = fetcher(() => {
      throw new Error('Unexpected command');
    });
    await mount(true);
    expect(document.querySelector('[data-testid="organization-workspace"]')?.textContent).toBe(
      'Organization date 2026-11-01',
    );
    expect(api.fetch).not.toHaveBeenCalled();
    await settle(() => button('Edit organization draft').click());
    expect(button('Assignments & positions').getAttribute('aria-disabled')).toBe('true');
    await settle(() => button('Assignments & positions').click());
    expect(mocks.push).not.toHaveBeenCalled();
    await settle(() => button('Clear organization draft').click());
    expect(button('Assignments & positions').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('locks date and view navigation until creation and retirement drafts are explicitly cleared', async () => {
    fetcher(() => {
      throw new Error('Draft editing must not send a command');
    });
    await mount(true);
    await vi.waitFor(async () => {
      await settle();
      expect(document.body.textContent).toContain('Synthetic Unassigned');
    });
    await fill('Position', 'Unsaved synthetic capacity');
    expect(button('Organization').getAttribute('aria-disabled')).toBe('true');
    expect(field('Staffing as of').disabled).toBe(true);
    await settle(() => button('Organization').click());
    expect(mocks.push).not.toHaveBeenCalled();
    await settle(() => button('Clear position draft').click());
    expect(field('Position').value).toBe('');
    expect(button('Organization').getAttribute('aria-disabled')).not.toBe('true');
    await openRetirement();
    expect(button('Organization').getAttribute('aria-disabled')).toBe('true');
    await settle(() => button('Cancel retirement draft').click());
    expect(button('Organization').getAttribute('aria-disabled')).not.toBe('true');
    expect(field('Staffing as of').disabled).toBe(false);
  });

  it('shows blockers and exact assignment context, and invalidates a preview whenever its inputs change', async () => {
    const blocked = impact();
    blocked.retirementBlocked = true;
    blocked.blockers = [
      {
        code: 'position_authorization_invalidates_assignment',
        recordId: 'synthetic-assignment',
        detail: 'Synthetic future assignment requires this position.',
      },
    ];
    blocked.assignments = [
      {
        id: 'synthetic-assignment',
        staffingPositionId: 'synthetic-seat',
        memberId: 88,
        firstName: 'Synthetic',
        lastName: 'Future Member',
        status: 'planned',
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
        timing: 'future',
      },
    ];
    blocked.organizationVersions = [
      {
        id: 'synthetic-unit',
        kind: 'APPARATUS',
        name: 'Synthetic Engine Review',
        revision: 1,
        parentId: null,
        status: 'active',
        effectiveOn: '2026-01-01',
        nextEffectiveOn: null,
        evidenceRef: 'synthetic-unit-evidence',
      },
    ];
    blocked.organizationLinks = [
      {
        staffingPositionId: 'synthetic-seat',
        stableSlotKey: 'SYNTHETIC/E/SEAT',
        organizationUnitId: 'synthetic-unit',
        revision: 1,
        effectiveOn: '2026-02-01',
        nextEffectiveOn: null,
        evidenceRef: 'synthetic-link-evidence',
      },
    ];
    const api = fetcher((sent) => {
      expect(sent.path).toBe('/api/admin/personnel/changes/preview');
      return response({ preview: true, impact: blocked });
    });
    await mount();
    await openRetirement();
    expect(button('Confirm retirement').disabled).toBe(true);
    await settle(() => button('Preview retirement').click());
    expect(button('Confirm retirement').disabled).toBe(true);
    expect(document.body.textContent).toContain(
      'Synthetic future assignment requires this position.',
    );
    expect(document.body.textContent).toContain('planned · 2026-10-01 through open-ended');
    expect(document.body.textContent).toContain(
      'Historical assignments and organization records will be retained.',
    );
    expect([...document.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toContain(
      `/admin/department?memberId=88&as_of=${DATE}`,
    );
    expect(document.body.textContent).toContain('Synthetic Engine Review');
    expect(document.body.textContent).toContain('Effective 2026-02-01 onward');
    expect(api.sent).toHaveLength(1);
    await fill('Retirement date', '2026-11-01');
    expect(document.querySelector('[aria-label="Retirement impact"]')).toBeNull();
    expect(button('Confirm retirement').disabled).toBe(true);
  });

  it('keeps an uncertain retirement locked through authentication failure and retrieves the original receipt', async () => {
    let attempts = 0;
    const api = fetcher((sent) => {
      if (sent.path.endsWith('/preview'))
        return response({ preview: true, impact: impact(String(sent.payload.effective_on)) });
      attempts += 1;
      if (attempts === 1) throw new TypeError('Synthetic response lost');
      if (attempts === 2) return response({ error: 'authentication_required' }, 401);
      return response({
        replayed: true,
        event: { id: 'synthetic-recorded-retirement', kind: 'POSITION_RETIRE' },
      });
    });
    await mount();
    await openRetirement();
    await settle(() => button('Preview retirement').click());
    expect(button('Confirm retirement').disabled).toBe(false);
    await settle(() => button('Confirm retirement').click());
    expect(field('Retirement date').matches(':disabled')).toBe(true);
    expect(field('Retirement reason').matches(':disabled')).toBe(true);
    expect(button('Retire seat').disabled).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await settle(() => button('Retry same retirement request').click());
    expect(field('Retirement reason').matches(':disabled')).toBe(true);
    expect(button('Retry same retirement request').disabled).toBe(false);
    await settle(() => button('Retry same retirement request').click());
    const commits = api.sent.filter((sent) => !sent.path.endsWith('/preview'));
    expect(commits).toHaveLength(3);
    expect(commits[0]?.key).toMatch(/^staffing-position-/);
    expect(commits[1]).toEqual(commits[0]);
    expect(commits[2]).toEqual(commits[0]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      'Position retired through the effective-dated lifecycle.',
    );
  });

  it('does not accept a successful HTTP response without a lifecycle receipt and retains generated create identity', async () => {
    let attempts = 0;
    const api = fetcher(() =>
      ++attempts === 1
        ? response({ replayed: false }, 201)
        : response({ replayed: true, event: { id: 'synthetic-created', kind: 'POSITION_CREATE' } }),
    );
    await mount();
    await fill('Shift', 'Training Shift');
    await fill('Station', 'Synthetic Station');
    await fill('Unit', 'Synthetic Engine');
    await fill('Position', 'Synthetic New Position');
    await fill('Reason', 'Synthetic create approval');
    const form = field('Shift').closest('form');
    await settle(() =>
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(field('Shift').matches(':disabled')).toBe(true);
    expect(field('Position').value).toBe('Synthetic New Position');
    expect(mocks.refresh).not.toHaveBeenCalled();
    await settle(() =>
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(api.sent).toHaveLength(2);
    expect(api.sent[1]).toEqual(api.sent[0]);
    expect((api.sent[0]?.payload.staffing_position as { shift: string; id: string }).shift).toBe(
      'Training Shift',
    );
    expect((api.sent[0]?.payload.staffing_position as { id: string }).id).toMatch(/^admin-/);
    expect(field('Shift').matches(':disabled')).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched preview and requires a new preview after a definite commit rejection', async () => {
    let previews = 0;
    const api = fetcher((sent) => {
      if (sent.path.endsWith('/preview')) {
        previews += 1;
        const result = impact();
        if (previews === 1) result.target.id = 'different-seat';
        return response({ preview: true, impact: result });
      }
      return response({ error: 'position_occupied_requires_vacancy' }, 409);
    });
    await mount();
    await openRetirement();
    await settle(() => button('Preview retirement').click());
    expect(button('Confirm retirement').disabled).toBe(true);
    await settle(() => button('Preview retirement').click());
    expect(button('Confirm retirement').disabled).toBe(false);
    await settle(() => button('Confirm retirement').click());
    expect(button('Confirm retirement').disabled).toBe(true);
    expect(field('Retirement reason').matches(':disabled')).toBe(false);
    expect(document.body.textContent).toContain('position occupied requires vacancy');
    expect(api.sent).toHaveLength(3);
  });
});
