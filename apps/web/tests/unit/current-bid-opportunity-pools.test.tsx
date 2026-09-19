// @vitest-environment jsdom
import type { BidDefinitionContent, FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import { act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BidOpportunityPoolFields } from '../../app/admin/current-bid/BidOpportunityPoolFields';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
type Pools = FrozenAnnualOperationsPolicy['opportunityPools'];
let root: Root | undefined;
let host: HTMLDivElement;
let current: Pools;
const changed = vi.fn();
const pools: NonNullable<Pools> = [
  {
    id: 'synthetic-pool',
    label: 'Synthetic station pool',
    kind: 'STATION_POOL',
    sourceRef: 'Synthetic policy clause',
    sourceDecisionId: 'reviewed-source',
    positionIds: ['z-first', 'a-second'],
  },
];
const decisions: BidDefinitionContent['sourceDecisions'] = [
  {
    issueId: 'reviewed-source',
    title: 'Synthetic reviewed source',
    question: '',
    area: 'annual-policy',
    status: 'RESOLVED',
    decision: 'Synthetic reviewed grouping',
    sourceRef: 'Synthetic source',
    effectiveOn: '2027-01-01',
  },
  {
    issueId: 'wrong-area',
    title: 'Position source',
    question: '',
    area: 'positions',
    status: 'RESOLVED',
    decision: '',
    sourceRef: '',
    effectiveOn: '2027-01-01',
  },
];
async function settle(action: () => void) {
  await act(async () => {
    action();
  });
}
async function mount(initial?: Pools) {
  current = initial;
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <BidOpportunityPoolFields
        value={value}
        opportunities={[
          { value: 'a-second', label: 'Synthetic second slot' },
          { value: 'z-first', label: 'Synthetic first slot' },
        ]}
        sourceDecisions={decisions}
        onChange={(next) => {
          current = next;
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await settle(() => root?.render(<Harness />));
}
function field(label: string): HTMLInputElement | HTMLSelectElement {
  const node = [...host.querySelectorAll('label')].find((entry) => entry.textContent === label);
  const input = node?.htmlFor
    ? document.getElementById(node.htmlFor)
    : node?.querySelector('input');
  if (!input) throw new Error(`Missing ${label}`);
  return input as HTMLInputElement | HTMLSelectElement;
}
function button(label: string, index = 0) {
  const node = [...host.querySelectorAll('button')].filter((entry) => entry.textContent === label)[
    index
  ];
  if (!node) throw new Error(`Missing ${label}`);
  return node;
}
afterEach(async () => {
  await settle(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  changed.mockClear();
});
describe('explicit opportunity pool authoring', () => {
  it('preserves historical absence until explicitly enabled and removes the optional definition when disabled', async () => {
    await mount();
    expect(changed).not.toHaveBeenCalled();
    expect(current).toBeUndefined();
    await settle(() => field('Configure opportunity pools').click());
    expect(current).toEqual([]);
    await settle(() => button('Add opportunity pool').click());
    expect(current).toMatchObject([
      { label: '', sourceRef: '', sourceDecisionId: '', positionIds: [] },
    ]);
    await settle(() => field('Configure opportunity pools').click());
    expect(current).toBeUndefined();
  });
  it('retains saved reservation order independent of catalog sorting and allows explicit reordering', async () => {
    await mount(structuredClone(pools));
    expect(changed).not.toHaveBeenCalled();
    expect(field('Capacity slot 1').value).toBe('z-first');
    expect(field('Capacity slot 2').value).toBe('a-second');
    await settle(() => button('Move down').click());
    expect(current?.[0]?.positionIds).toEqual(['a-second', 'z-first']);
    expect(current?.[0]?.sourceDecisionId).toBe('reviewed-source');
  });
  it('offers explicit kind and annual-policy decisions, preserving source text while editing', async () => {
    await mount(structuredClone(pools));
    expect(
      [...(field('Pool source decision') as HTMLSelectElement).options].map(
        (option) => option.value,
      ),
    ).toEqual(['', 'reviewed-source']);
    await settle(() => {
      const select = field('Pool kind');
      select.value = 'FLOAT_POOL';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(current?.[0]).toMatchObject({
      kind: 'FLOAT_POOL',
      sourceRef: 'Synthetic policy clause',
      sourceDecisionId: 'reviewed-source',
    });
  });
  it('retains missing saved slots for review and removes only the explicitly selected pool', async () => {
    const saved = pools[0];
    if (!saved) throw new Error('Synthetic pool missing');
    await mount([
      {
        ...saved,
        positionIds: ['missing-reviewed-slot'],
        sourceDecisionId: 'missing-reviewed-source',
      },
      { ...saved, id: 'second' },
    ]);
    expect(host.textContent).toContain(
      'missing-reviewed-slot · Saved slot; catalog review required',
    );
    expect(host.textContent).toContain(
      'missing-reviewed-source · Saved decision; source review required',
    );
    expect(changed).not.toHaveBeenCalled();
    await settle(() => button('Remove opportunity pool 1').click());
    expect(current).toHaveLength(1);
    expect(current?.[0]?.id).toBe('second');
  });
});
