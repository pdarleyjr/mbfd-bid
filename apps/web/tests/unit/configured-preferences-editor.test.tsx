// @vitest-environment jsdom
import { type ConfiguredScoring, ConfiguredScoringSchema } from '@mbfd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfiguredScoringEditor } from '../../app/admin/positions/[id]/edit/ConfiguredScoringEditor';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const roots: Root[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
});
function render(initial: ConfiguredScoring) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  clients.push(client);
  client.setQueryData(
    ['admin', 'credentials'],
    [
      { id: 1, name: 'Course I' },
      { id: 2, name: 'Course II' },
    ],
  );
  let current = initial;
  function Controlled() {
    const [value, setValue] = useState(initial);
    return (
      <ConfiguredScoringEditor
        value={value}
        visibleChannels={['total']}
        onChange={(next) => {
          current = next;
          setValue(next);
        }}
      />
    );
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Controlled />
      </QueryClientProvider>,
    ),
  );
  return { container, value: () => current };
}
function button(container: HTMLElement, label: string) {
  const b = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!b) throw new Error(label);
  return b;
}
function field(container: HTMLElement, label: string) {
  const l = Array.from(container.querySelectorAll('label')).find(
    (l) =>
      Array.from(l.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join('')
        .trim() === label,
  );
  const f = l?.querySelector('input,select');
  if (!(f instanceof HTMLInputElement || f instanceof HTMLSelectElement)) throw new Error(label);
  return f;
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLSelectElement.prototype,
      'value',
    )?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const empty: ConfiguredScoring = { v: 1, total: [], so: [], mo: [] };

describe('cumulative preference authoring', () => {
  it('starts only on explicit request with a blank source and no invented criteria or weights', async () => {
    const r = render(empty);
    expect(r.value()).toEqual(empty);
    await act(async () =>
      button(r.container, 'Add cumulative preferences for total points').click(),
    );
    expect(r.value().total[0]).toMatchObject({
      cap: null,
      items: [],
      preference: { mode: 'BINARY_CUMULATIVE', sourceRef: '', criteria: [] },
    });
    expect(ConfiguredScoringSchema.safeParse(r.value()).success).toBe(false);
    expect(r.container.textContent).not.toContain('Group cap');
    await change(
      field(r.container, 'Preference policy source'),
      'Synthetic source p1 cumulative rule',
    );
    await act(async () => button(r.container, 'Add preference criterion').click());
    await change(field(r.container, 'Preference credential'), 'Course I');
    await change(
      field(r.container, 'Required for this preference (all must be held)'),
      'Course II',
    );
    const parsed = ConfiguredScoringSchema.parse(r.value());
    expect(parsed.total[0]?.preference?.criteria).toEqual([
      { credential: 'Course I', alternatives: [], requiresAll: ['Course II'] },
    ]);
    expect(JSON.stringify(parsed)).not.toContain('"points"');
  });
  it('preserves saved preferences and historical numeric channels while editing source text', async () => {
    const initial: ConfiguredScoring = {
      ...empty,
      total: [
        {
          id: 'binary',
          cap: null,
          items: [],
          preference: {
            mode: 'BINARY_CUMULATIVE',
            sourceRef: 'Synthetic saved source',
            criteria: [
              {
                credential: 'Missing saved course',
                alternatives: ['Course I'],
                requiresAll: ['Course II'],
              },
            ],
          },
        },
      ],
      so: [
        {
          id: 'numeric',
          cap: 4,
          items: [{ credential: 'Numeric source', alternatives: [], requiresAll: [], points: 7 }],
        },
      ],
    };
    const r = render(initial);
    expect(r.container.textContent).toContain('Missing saved course · Catalog review required');
    await change(field(r.container, 'Preference policy source'), 'Synthetic revised source');
    expect(r.value().so).toEqual(initial.so);
    expect(r.value().total[0]?.preference?.criteria).toEqual(
      initial.total[0]?.preference?.criteria,
    );
    expect(initial.total[0]?.preference?.sourceRef).toBe('Synthetic saved source');
  });
});

describe('ordered qualification authoring', () => {
  it('requires explicit source and selected qualifications without invented tier weights', async () => {
    const r = render(empty);
    const toggle = field(r.container, 'Compare listed qualifications before cumulative credits');
    await act(async () => toggle.click());
    expect(r.value().orderedPreference).toEqual({
      mode: 'ORDERED_QUALIFICATIONS',
      sourceRef: '',
      criteria: [],
    });
    expect(ConfiguredScoringSchema.safeParse(r.value()).success).toBe(false);
    await change(
      field(r.container, 'Qualification priority source'),
      'Synthetic first-tier source',
    );
    await act(async () => button(r.container, 'Add priority qualification').click());
    await change(field(r.container, 'Priority qualification 1'), 'Course I');
    expect(ConfiguredScoringSchema.parse(r.value()).orderedPreference?.criteria).toEqual([
      { credential: 'Course I', alternatives: [], requiresAll: [] },
    ]);
    expect(JSON.stringify(r.value())).not.toContain('"points"');
    await act(async () => toggle.click());
    expect(r.value()).toEqual(empty);
  });
});
