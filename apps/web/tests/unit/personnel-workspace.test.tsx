// @vitest-environment jsdom
import { type ComponentProps, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';
import { PersonnelWorkspace as PersonnelComponent } from '../../app/admin/personnel/PersonnelWorkspace';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
function PersonnelWorkspace(props: ComponentProps<typeof PersonnelComponent>) {
  return (
    <AdminQueryProvider>
      <PersonnelComponent {...props} />
    </AdminQueryProvider>
  );
}

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  document.body.replaceChildren();
  router.refresh.mockClear();
  vi.unstubAllGlobals();
});

async function setValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
    'value',
  );
  descriptor?.set?.call(control, value);
  await act(async () => {
    control.dispatchEvent(new Event('change', { bubbles: true }));
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function controlByLabel<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  container: HTMLElement,
  label: string,
): T {
  const element = Array.from(container.querySelectorAll('label'))
    .find((candidate) => candidate.textContent?.includes(label))
    ?.querySelector('input, select, textarea');
  if (element === null || element === undefined) {
    throw new Error(`Missing control labelled ${label}`);
  }
  return element as T;
}

describe('PersonnelWorkspace', () => {
  it('retains overlay create and end requests after response loss without an unhandled rejection', async () => {
    const attempts: { url: string; init: RequestInit }[] = [];
    let created = false;
    let ended = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/csrf')
          return Response.json({ token: 'csrf_11111111-1111-1111-1111-111111111111' });
        if (init?.method !== 'POST')
          return Response.json({
            overlays: created
              ? [
                  {
                    id: 'synthetic-overlay',
                    member_id: 901,
                    kind: 'LIGHT_DUTY',
                    effective_on: '2027-01-01',
                    status: ended ? 'ended' : 'active',
                    actual_end_on: ended ? '2027-01-01' : null,
                  },
                ]
              : [],
          });
        if (url.endsWith('/preview')) return Response.json({ ok: true });
        attempts.push({ url, init });
        if (url.endsWith('/end')) ended = true;
        else created = true;
        if (attempts.filter((r) => r.url === url).length === 1)
          throw new TypeError('Synthetic overlay response loss');
        return Response.json({
          replayed: true,
          overlayId: 'synthetic-overlay',
          status: ended ? 'ended' : 'active',
        });
      }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <PersonnelWorkspace
          summary={{
            asOf: '2027-01-01',
            members: { active: 1, inactive: 0, retired: 0, separated: 0, unclassified: 0 },
            activeAssignments: 1,
            upcomingChanges: 0,
          }}
          members={[
            {
              id: 901,
              employeeId: 'synthetic-901',
              firstName: 'Synthetic',
              lastName: 'Member',
              rank: 'FF',
              employmentStatus: 'active',
              employmentStatusEffectiveOn: '2027-01-01',
              separationType: null,
            },
          ]}
        />,
      ),
    );
    const form = container.querySelector<HTMLFormElement>('[data-testid="temporary-overlay-form"]');
    if (!form) throw new Error('Missing overlay form');
    await setValue(controlByLabel(form, 'Overlay type'), 'LIGHT_DUTY');
    await setValue(controlByLabel(form, 'Underlying assignment ID'), 'synthetic-assignment');
    await setValue(controlByLabel(form, 'Underlying position ID'), 'synthetic-position');
    const submit = async () =>
      act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    await submit();
    await submit();
    expect(container.textContent).toContain('Synthetic overlay response loss');
    expect(router.refresh).not.toHaveBeenCalled();
    await submit();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    const endButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'End overlay',
    );
    if (!endButton) throw new Error('Missing end overlay button');
    await act(async () => endButton.click());
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => endButton.click());
    expect(router.refresh).toHaveBeenCalledTimes(2);
    for (const path of [
      '/api/admin/personnel/temporary-overlays',
      '/api/admin/personnel/temporary-overlays/synthetic-overlay/end',
    ]) {
      const pair = attempts.filter((r) => r.url === path);
      expect(pair).toHaveLength(2);
      expect(pair[0]?.init.body).toBe(pair[1]?.init.body);
      expect(new Headers(pair[0]?.init.headers).get('Idempotency-Key')).toBe(
        new Headers(pair[1]?.init.headers).get('Idempotency-Key'),
      );
    }
    await act(async () => root.unmount());
  });
  it('requires a new preview after editing the reviewed change and commits only the new values', async () => {
    const requests: { url: string; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/auth/csrf')
          return Response.json({ token: 'csrf_11111111-1111-1111-1111-111111111111' });
        if (String(input) === '/api/admin/personnel/temporary-overlays')
          return Response.json({ overlays: [] });
        requests.push({ url: String(input), body: String(init?.body) });
        return Response.json({ replayed: false, event: { kind: 'TRANSFER' } }, { status: 200 });
      }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <PersonnelWorkspace
          summary={{
            asOf: '2027-01-01',
            members: { active: 1, inactive: 0, retired: 0, separated: 0, unclassified: 0 },
            activeAssignments: 1,
            upcomingChanges: 0,
          }}
          members={[
            {
              id: 901,
              employeeId: 'synthetic-901',
              firstName: 'Synthetic',
              lastName: 'Member',
              rank: 'FF',
              employmentStatus: 'active',
              employmentStatusEffectiveOn: '2027-01-01',
              separationType: null,
            },
          ]}
        />,
      ),
    );
    const reason = controlByLabel<HTMLTextAreaElement>(container, 'Operator reason');
    await setValue(reason, 'First reviewed explanation');
    const form = container.querySelector<HTMLFormElement>('[data-testid="personnel-change-form"]');
    if (!form) throw new Error('Missing personnel form');
    const submit = async () =>
      act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    await submit();
    expect(requests.map((r) => r.url)).toEqual(['/api/admin/personnel/changes/preview']);
    await setValue(reason, 'Corrected reviewed explanation');
    await submit();
    expect(requests.map((r) => r.url)).toEqual([
      '/api/admin/personnel/changes/preview',
      '/api/admin/personnel/changes/preview',
    ]);
    await submit();
    expect(requests[2]?.url).toBe('/api/admin/personnel/changes');
    expect(requests[2]?.body).toBe(requests[1]?.body);
    expect(JSON.parse(requests[2]?.body ?? '{}').reason).toBe('Corrected reviewed explanation');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
  it('makes synthetic roster state, unclassified legacy members, and the append-only change workflow visible', () => {
    const html = renderToString(
      <PersonnelWorkspace
        summary={{
          asOf: '2026-08-28',
          members: { active: 1, inactive: 0, retired: 0, separated: 0, unclassified: 1 },
          activeAssignments: 1,
          upcomingChanges: 1,
        }}
        members={[
          {
            id: 1,
            employeeId: 'synthetic-001',
            firstName: 'Synthetic',
            lastName: 'Firefighter',
            rank: 'FF',
            employmentStatus: 'active',
            employmentStatusEffectiveOn: '2026-01-01',
            separationType: null,
          },
          {
            id: 2,
            employeeId: 'synthetic-legacy',
            firstName: 'Legacy',
            lastName: 'Unclassified',
            rank: 'FF',
            employmentStatus: 'unknown',
            employmentStatusEffectiveOn: null,
            separationType: null,
          },
          {
            id: 3,
            employeeId: 'civilian-001',
            firstName: 'Civilian',
            lastName: 'Employee',
            rank: null,
            employmentStatus: 'active',
            employmentStatusEffectiveOn: '2026-09-04',
            separationType: null,
          },
        ]}
      />,
    );

    expect(html).toContain('Personnel lifecycle');
    expect(html).toContain('Synthetic');
    expect(html).toContain('Firefighter');
    expect(html).toContain('Needs classification');
    expect(html).toContain('New hire / reactivation');
    expect(html).toContain('No historical member or assignment is deleted');
    expect(html).toContain('data-testid="personnel-change-form"');
    expect(html).toContain('Preview before recording');
    expect(html).toContain('Temporary operational overlays');
    expect(html).toContain('data-testid="temporary-overlay-form"');
    expect(html).toContain('Special Assignment');
    expect(html).toContain('Light Duty');
    expect(html).toContain('Civilian / no fire rank');
    expect(html).toContain('not required for excluded personnel');
    expect(html).toContain('Civilian / no fire rank');
  });

  it('uses a member and assignment query hint to orient an operator in history', () => {
    const html = renderToString(
      <PersonnelWorkspace
        summary={{
          asOf: '2026-08-28',
          members: { active: 1, inactive: 0, retired: 0, separated: 0, unclassified: 0 },
          activeAssignments: 1,
          upcomingChanges: 0,
        }}
        members={[
          {
            id: 1,
            employeeId: 'synthetic-001',
            firstName: 'Synthetic',
            lastName: 'Firefighter',
            rank: 'FF',
            employmentStatus: 'active',
            employmentStatusEffectiveOn: '2026-01-01',
            separationType: null,
          },
          {
            id: 2,
            employeeId: 'synthetic-002',
            firstName: 'Linked',
            lastName: 'Member',
            rank: 'LT',
            employmentStatus: 'active',
            employmentStatusEffectiveOn: '2026-01-01',
            separationType: null,
          },
        ]}
        memberIdHint={2}
        assignmentIdHint="assignment-linked"
      />,
    );

    expect(html).toContain('data-testid="personnel-link-context"');
    expect(html).toContain('assignment-linked');
    expect(html).toContain('<option value="2" selected="">');
  });

  it('retains the constructed new-hire request through response loss and refreshes only after receipt', async () => {
    const requests: Array<{ input: RequestInfo | URL; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init: init ?? {} });
        if (String(input) === '/api/auth/csrf')
          return new Response(
            JSON.stringify({ token: 'csrf_11111111-1111-1111-1111-111111111111' }),
            { status: 200 },
          );
        if (
          String(input) === '/api/admin/personnel/changes' &&
          requests.filter((r) => String(r.input) === '/api/admin/personnel/changes').length === 1
        )
          throw new TypeError('Synthetic response loss');
        return new Response(JSON.stringify({ replayed: false, event: { kind: 'NEW_HIRE' } }), {
          status: 201,
        });
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PersonnelWorkspace
          summary={{
            asOf: '2026-09-04',
            members: { active: 0, inactive: 0, retired: 0, separated: 0, unclassified: 0 },
            activeAssignments: 0,
            upcomingChanges: 0,
          }}
          members={[]}
        />,
      );
    });

    await setValue(controlByLabel(container, 'Change type'), 'NEW_HIRE');
    await setValue(controlByLabel(container, 'Synthetic employee ID'), '25982');
    await setValue(controlByLabel(container, 'First name'), 'Gerald');
    await setValue(controlByLabel(container, 'Last name'), 'De Young');
    await setValue(controlByLabel(container, 'Bid category'), 'EXCLUDED');
    await setValue(controlByLabel(container, 'Rank after change'), 'CIVILIAN');
    await setValue(
      controlByLabel(container, 'Operator reason'),
      'Owner-approved excluded civilian onboarding.',
    );

    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit === null) throw new Error('Missing personnel submit button');
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Synthetic response loss');
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const attempts = requests.filter((r) => String(r.input) === '/api/admin/personnel/changes');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.init.body).toEqual(attempts[1]?.init.body);
    expect(new Headers(attempts[0]?.init.headers).get('Idempotency-Key')).toBe(
      new Headers(attempts[1]?.init.headers).get('Idempotency-Key'),
    );

    const submission = requests.find(
      (request) => String(request.input) === '/api/admin/personnel/changes',
    );
    expect(submission).toBeDefined();
    expect(JSON.parse(String(submission?.init.body))).toMatchObject({
      kind: 'NEW_HIRE',
      new_member: {
        employee_id: '25982',
        first_name: 'Gerald',
        last_name: 'De Young',
        rank: null,
        bid_category: 'EXCLUDED',
      },
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Refresh the workspace to view');
    act(() => root.unmount());
  });
});
