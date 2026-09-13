// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationWorkspace } from '../../app/admin/organization/OrganizationWorkspace';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const roots: Root[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const unit = {
  id: 'synthetic-station',
  kind: 'STATION',
  name: 'Synthetic Station',
  parentId: null,
  effectiveOn: '2026-01-01',
  status: 'active',
  revision: 1,
  latestRevision: 1,
};
const dependencies = (date: string, blocked: boolean) => ({
  retirementBlocked: blocked,
  children: [],
  seats: [],
  impact: {
    target: {
      id: unit.id,
      kind: unit.kind,
      name: unit.name,
      authorization: {
        status: 'active',
        revision: 1,
        effectiveOn: unit.effectiveOn,
        parentId: null,
      },
    },
    effectiveOn: date,
    lastActiveOn: null,
    retirementBlocked: blocked,
    retainsHistory: true,
    blockers: blocked
      ? [
          {
            code: 'organization_dependencies_require_review',
            recordId: 'synthetic-child',
            detail: 'Synthetic future child is still linked.',
          },
        ]
      : [],
    assignments: [],
    organizationVersions: [],
    organizationLinks: [],
  },
});
function read(input: RequestInfo | URL) {
  const url = new URL(String(input), 'https://synthetic.invalid');
  if (url.pathname === '/api/auth/csrf')
    return Response.json({ token: 'csrf_11111111-1111-1111-1111-111111111111' });
  if (url.pathname === '/api/admin/organization')
    return Response.json({ asOf: '2026-09-12', units: [unit] });
  if (url.pathname === '/api/admin/organization/seats/links') return Response.json({ links: [] });
  if (url.pathname === '/api/admin/department/current-roster')
    return Response.json({
      asOf: '2026-09-12',
      positions: [],
      summary: { totalPositions: 0, occupiedPositions: 0, vacantPositions: 0 },
      unassignedMembers: [],
      updatedAt: null,
    });
  throw new Error(`Unplanned read ${url.pathname}`);
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <OrganizationWorkspace initialDate="2026-09-12" />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return container;
}
function button(container: HTMLElement, text: string) {
  const control = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  );
  if (!control) throw new Error(`Missing ${text}`);
  return control;
}
async function click(control: HTMLButtonElement) {
  await act(async () => {
    control.click();
  });
  await settle();
}
function field(container: HTMLElement, text: string) {
  const control = [...container.querySelectorAll('label')]
    .find((node) => node.textContent?.startsWith(text))
    ?.querySelector('input,select,textarea');
  if (!control) throw new Error(`Missing ${text}`);
  return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}
async function fill(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function prepare(container: HTMLElement) {
  await click(button(container, 'Edit'));
  await fill(field(container, 'Effective on'), '2026-09-15');
  await fill(field(container, 'Lifecycle'), 'retired');
  await fill(field(container, 'Authoritative source reference'), 'Synthetic source only');
  await fill(field(container, 'Reason'), 'Synthetic retirement review');
  await settle();
}
describe('Department organization retirement workflow', () => {
  it('requires a successful unblocked date-specific impact before permitting retirement', async () => {
    let finish: ((response: Response) => void) | undefined;
    const writes: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'https://synthetic.invalid');
        if (init?.method === 'PATCH') {
          writes.push(init);
          throw new Error('Unexpected write');
        }
        if (url.pathname.endsWith('/dependencies')) {
          if (url.searchParams.get('as_of') === '2026-09-15')
            return new Promise<Response>((resolve) => {
              finish = resolve;
            });
          return Response.json(dependencies(url.searchParams.get('as_of') ?? '', false));
        }
        return read(input);
      }),
    );
    const container = await render();
    await prepare(container);
    expect(button(container, 'Confirm retirement').disabled).toBe(true);
    await act(async () => finish?.(Response.json(dependencies('2026-09-15', true))));
    await settle();
    expect(container.textContent).toContain('Synthetic future child is still linked.');
    expect(button(container, 'Confirm retirement').disabled).toBe(true);
    expect(writes).toHaveLength(0);
    await fill(field(container, 'Effective on'), '2026-09-16');
    await settle();
    expect(button(container, 'Confirm retirement').disabled).toBe(false);
    expect(container.textContent).not.toContain('Synthetic future child is still linked.');
  });

  it('locks a lost commit and retries its exact body and identity to recover the receipt', async () => {
    const writes: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'https://synthetic.invalid');
        if (init?.method === 'PATCH') {
          writes.push(init);
          if (writes.length === 1) throw new TypeError('Synthetic response lost');
          const body = JSON.parse(String(init.body));
          return Response.json({
            replayed: true,
            unit: {
              ...unit,
              name: body.display_name,
              effectiveOn: body.effective_on,
              parentId: body.parent_id,
              status: body.status,
              revision: body.expected_revision + 1,
            },
          });
        }
        if (url.pathname.endsWith('/dependencies'))
          return Response.json(dependencies(url.searchParams.get('as_of') ?? '', false));
        return read(input);
      }),
    );
    const container = await render();
    await prepare(container);
    await click(button(container, 'Confirm retirement'));
    expect(writes).toHaveLength(1);
    expect(field(container, 'Effective on').closest('fieldset')?.disabled).toBe(true);
    expect(button(container, 'Cancel local edit').disabled).toBe(true);
    await click(button(container, 'Retry saved request'));
    expect(writes).toHaveLength(2);
    expect(writes[1]?.body).toBe(writes[0]?.body);
    expect(new Headers(writes[1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(writes[0]?.headers).get('Idempotency-Key'),
    );
    expect(container.textContent).toContain('Organization revision saved');
    expect(field(container, 'Display name').value).toBe('');
  });
});
