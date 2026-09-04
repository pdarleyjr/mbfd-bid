// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersonnelWorkspace } from '../../app/admin/personnel/PersonnelWorkspace';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  document.body.replaceChildren();
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

  it('submits the constructed payload for a new excluded civilian instead of null', async () => {
    const requests: Array<{ input: RequestInfo | URL; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init: init ?? {} });
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
    act(() => root.unmount());
  });
});
