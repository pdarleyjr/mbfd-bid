// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { RuleEditor } from '../../app/admin/positions/[id]/edit/RuleEditor';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

const KNOWN_RULE = {
  id: 41,
  requiredCriteria: {
    rank: ['LT', 'CPT'],
    credentials: ['Driver Engineer Qualified', 'State Certified Hazardous Materials Technician'],
    custom: ['driver_engineer', 'non_probationary'],
  },
  pointsPreference: {
    max: 8,
    items: [
      {
        credential: 'Rope Rescue Technician',
        points: 3,
        opsGate: 'paired_operation',
      },
      {
        credential: 'State Certified Hazardous Materials Technician',
        points: 5,
        gating: 'ops_all_6',
      },
    ],
  },
  tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
};

interface TestRule {
  id: number;
  requiredCriteria: unknown;
  pointsPreference: unknown;
  tieBreakChain: unknown;
}

beforeEach(() => {
  window.localStorage.clear();
  routerRefresh.mockReset();
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderEditor(initialRule: TestRule = KNOWN_RULE) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['admin', 'credentials'], []);
  client.setQueryData(['admin', 'service-evidence', 'types'], {
    types: [{ id: 'RESCUE_DIVISION', name: 'Cumulative Rescue Division service' }],
  });

  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <RuleEditor positionId="A205" ruleBookVersion="2027.2" initialRule={initialRule} />
      </QueryClientProvider>,
    );
  });

  const form = container.querySelector('form');
  if (!form) throw new Error('Rule editor form did not render.');
  return { container, form };
}

async function setControl(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Control value setter is unavailable.');
    setter.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(control: HTMLButtonElement | HTMLInputElement) {
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function requiredControl<T>(container: HTMLElement, testId: string): T {
  const control = container.querySelector(`[data-testid="${testId}"]`);
  if (!control) throw new Error(`Expected rule editor control ${testId}.`);
  return control as T;
}

describe('RuleEditor', () => {
  it('uses typed policy controls and explains that credential names must match credential records', () => {
    const editorPath = resolve(process.cwd(), 'app/admin/positions/[id]/edit/RuleEditor.tsx');
    const source = readFileSync(editorPath, 'utf8');
    const { container } = renderEditor();

    expect(source).not.toContain('JSON.parse');
    expect(container.textContent).not.toContain('JSON');
    expect(container.textContent).toContain('Required ranks');
    expect(container.textContent).toContain('Required credential names');
    expect(container.textContent).toContain('exactly as they appear in credential records');
    expect(container.textContent).toContain('Custom eligibility conditions');
    expect(container.textContent).toContain('Maximum points');
    expect(container.textContent).toContain('Tie-break order');
    expect(container.querySelector('[data-testid="rule-required-credentials"]')).toBeInstanceOf(
      HTMLTextAreaElement,
    );
    expect(container.querySelector('[data-testid="rule-points-row-0-credential"]')).toBeInstanceOf(
      HTMLInputElement,
    );
  });

  it('normalizes known legacy gates into the existing structured PATCH contract', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input) === '/api/auth/csrf'
              ? { token: 'csrf_11111111-1111-1111-1111-111111111111' }
              : { rule: {} },
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container, form } = renderEditor();
    await setControl(
      requiredControl<HTMLTextAreaElement>(container, 'rule-reason'),
      'Correct policy data',
    );
    await submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/admin/rules/41',
    )?.[1];
    if (!request) throw new Error('Rule PATCH did not include request options.');
    expect(request.method).toBe('PATCH');
    expect(request.credentials).toBe('include');
    expect(new Headers(request.headers).get('Idempotency-Key')).toBeTruthy();
    expect(new Headers(request.headers).get('X-MBFD-CSRF')).toBe(
      'csrf_11111111-1111-1111-1111-111111111111',
    );
    expect(JSON.parse(String(request.body))).toEqual({
      required_criteria: {
        rank: ['LT', 'CPT'],
        credentials: [
          'Driver Engineer Qualified',
          'State Certified Hazardous Materials Technician',
        ],
        custom: ['driver_engineer', 'non_probationary'],
      },
      points_preference: {
        max: 8,
        items: [
          {
            credential: 'Rope Rescue Technician',
            points: 3,
            opsGate: 'paired_operation',
          },
          {
            credential: 'State Certified Hazardous Materials Technician',
            points: 5,
            opsGate: 'all_operations',
          },
        ],
      },
      tie_break_chain: ['points', 'rsc_seniority', 'rank_seniority'],
      reason_code: 'rule_override.fix_misconfig',
      reason: 'Correct policy data',
    });
  });

  it('allows repeatable credential point rows and never offers a duplicate selected tie-break key', async () => {
    const { container } = renderEditor({
      ...KNOWN_RULE,
      pointsPreference: { max: 0, items: [] },
    });

    await click(requiredControl<HTMLButtonElement>(container, 'rule-add-points-row'));
    expect(container.querySelector('[data-testid="rule-points-row-0-credential"]')).toBeInstanceOf(
      HTMLInputElement,
    );
    expect(container.querySelector('[data-testid="rule-points-row-0-points"]')).toBeInstanceOf(
      HTMLInputElement,
    );
    expect(container.querySelector('[data-testid="rule-points-row-0-ops-gate"]')).toBeInstanceOf(
      HTMLSelectElement,
    );

    const addTieBreak = requiredControl<HTMLSelectElement>(container, 'rule-tie-break-add');
    await setControl(addTieBreak, 'so_points');

    expect(
      [...container.querySelectorAll('[data-testid^="rule-tie-break-item-"]')].map((item) =>
        item.getAttribute('data-testid'),
      ),
    ).toEqual([
      'rule-tie-break-item-points',
      'rule-tie-break-item-rsc_seniority',
      'rule-tie-break-item-rank_seniority',
      'rule-tie-break-item-so_points',
    ]);
    expect([...addTieBreak.options].map((option) => option.value)).not.toContain('so_points');
    expect([...addTieBreak.options].map((option) => option.value)).not.toContain('points');
  });

  it('keeps focus with the remaining credential row when a preceding row is removed', async () => {
    const { container } = renderEditor({
      ...KNOWN_RULE,
      pointsPreference: { max: 0, items: [] },
    });

    await click(requiredControl<HTMLButtonElement>(container, 'rule-add-points-row'));
    await click(requiredControl<HTMLButtonElement>(container, 'rule-add-points-row'));

    const secondCredential = requiredControl<HTMLInputElement>(
      container,
      'rule-points-row-1-credential',
    );
    await act(async () => {
      secondCredential.focus();
    });
    expect(document.activeElement).toBe(secondCredential);

    const removeButtons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => button.textContent === 'Remove',
    );
    const firstRemove = removeButtons[0];
    if (!firstRemove) throw new Error('Expected a remove control for the first credential row.');
    await click(firstRemove);

    expect(document.activeElement).toBe(
      requiredControl<HTMLInputElement>(container, 'rule-points-row-0-credential'),
    );
  });

  it('visibly blocks an unsupported policy field without sending a lossy PATCH', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container, form } = renderEditor({
      ...KNOWN_RULE,
      requiredCriteria: {
        rank: ['FF'],
        credentials: [],
        custom: ['pre_bid_pool'],
        unsupported_policy_field: true,
      },
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'unsupported custom eligibility condition',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'unsupported field “unsupported_policy_field”',
    );
    expect(requiredControl<HTMLButtonElement>(container, 'rule-save').disabled).toBe(true);

    await setControl(
      requiredControl<HTMLTextAreaElement>(container, 'rule-reason'),
      'Correct policy data',
    );
    await submit(form);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('No changes will be sent until this is resolved.');
  });

  it('does not overwrite a legacy raw-rule local draft until an operator explicitly discards it', () => {
    window.localStorage.setItem(
      'mbfd-bid:draft:/admin/positions/A205/edit:rule',
      JSON.stringify({
        values: {
          ruleId: 41,
          required: '{"rank":["FF"]}',
          points: '{"max":0,"items":[]}',
          tie: '["points"]',
        },
        savedAt: '2026-08-28T00:00:00.000Z',
      }),
    );

    const { container } = renderEditor();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'not bound to this configured rule book',
    );
    expect(requiredControl<HTMLButtonElement>(container, 'rule-save').disabled).toBe(true);
    expect(
      window.localStorage.getItem('mbfd-bid:draft:/admin/positions/A205/edit:rule'),
    ).not.toBeNull();
  });
});
