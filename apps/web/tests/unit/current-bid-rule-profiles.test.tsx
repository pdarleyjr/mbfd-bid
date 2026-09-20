// @vitest-environment jsdom
import { type BidDefinitionContent, BidDefinitionContentSchema } from '@mbfd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidRuleProfiles } from '../../app/admin/current-bid/BidRuleProfiles';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const roots: ReturnType<typeof createRoot>[] = [];
const clients: QueryClient[] = [];

function content(): BidDefinitionContent {
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: 2027,
    settings: null,
    notes: { bid: null, positions: null },
    policy: null,
    planning: null,
    authoring: null,
    positions: [
      {
        id: 'synthetic-seat-1',
        positionName: 'Synthetic engine',
        shift: 'A',
        station: 'Synthetic station',
        unit: 'Engine',
        division: 'Operations',
        rankRequired: 'FF',
        isFloating: false,
        isVacantByDesign: false,
        isExcludedFromCount: false,
      },
      {
        id: 'synthetic-seat-2',
        positionName: 'Synthetic rescue',
        shift: 'B',
        station: 'Synthetic station',
        unit: 'Rescue',
        division: 'Operations',
        rankRequired: 'LT',
        isFloating: false,
        isVacantByDesign: false,
        isExcludedFromCount: false,
      },
    ],
    rules: [],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  });
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Synthetic fixture is incomplete');
  return value;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function control(scope: HTMLElement, label: string): Control {
  const fields: Control[] = [
    ...scope.querySelectorAll('input'),
    ...scope.querySelectorAll('select'),
    ...scope.querySelectorAll('textarea'),
  ];
  const matches = fields.filter((field) =>
    [...(field.labels ?? [])].some((candidate) => candidate.textContent?.trim() === label),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one control '${label}', found ${matches.length}`);
  return required(matches[0]);
}
function button(scope: HTMLElement, label: string): HTMLButtonElement {
  const matches = [...scope.querySelectorAll('button')].filter(
    (element) => element.textContent?.trim() === label,
  );
  if (matches.length !== 1)
    throw new Error(`Expected one button '${label}', found ${matches.length}`);
  return required(matches[0]);
}
async function click(element: Pick<HTMLElement, 'click'>) {
  await act(async () => element.click());
}
async function setValue(field: Control, value: string) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : field instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function renderProfiles(initial = content()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  clients.push(client);
  client.setQueryData(['admin', 'credentials'], []);
  client.setQueryData(['admin', 'service-evidence', 'types'], { types: [] });
  let current = structuredClone(initial);
  function Controlled() {
    const [value, setValue] = useState(current);
    return (
      <BidRuleProfiles
        content={value}
        selectedPositionId="synthetic-seat-1"
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected profile editor network call');
    }),
  );
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BidRuleProfiles', () => {
  it('authors an explicit family scope and a separate required rank without creating direct rules', async () => {
    const state = renderProfiles();
    await click(button(state.container, 'Add shared rule profile'));
    await setValue(control(state.container, 'Profile name'), 'Synthetic family requirements');
    await setValue(
      control(state.container, 'Policy source reference'),
      'Synthetic approved source',
    );
    await setValue(control(state.container, 'Applies to'), 'family');
    await setValue(control(state.container, 'Family name'), 'Synthetic family');
    await click(
      control(state.container, 'Synthetic engine · A shift · Synthetic station · synthetic-seat-1'),
    );
    await click(control(state.container, 'FF'));

    const authoring = required(state.value().authoring);
    expect(state.value().rules).toEqual([]);
    expect(authoring.compiled).toEqual([]);
    expect(authoring.reconciliation).toBe('PROFILE_EDITS_PENDING_REVIEW');
    expect(authoring.profiles).toHaveLength(1);
    expect(authoring.profiles[0]).toMatchObject({
      name: 'Synthetic family requirements',
      sourceRef: 'Synthetic approved source',
      scope: {
        kind: 'family',
        name: 'Synthetic family',
        positionIds: ['synthetic-seat-1'],
      },
      requirements: { ranks: ['FF'], credentials: [], custom: [] },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates a position override with an explicit position scope only', async () => {
    const state = renderProfiles();
    await click(button(state.container, 'Create position-specific override'));

    const authoring = required(state.value().authoring);
    expect(authoring.profiles).toHaveLength(1);
    expect(authoring.profiles[0]?.scope).toEqual({
      kind: 'position',
      positionId: 'synthetic-seat-1',
    });
    expect(authoring.reconciliation).toBe('PROFILE_EDITS_PENDING_REVIEW');
    expect(state.value().rules).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
