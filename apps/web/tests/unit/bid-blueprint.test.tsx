// @vitest-environment jsdom
import type { BidDefinitionContent } from '@mbfd/shared';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { BidBlueprint } from '../../app/admin/current-bid/BidBlueprint';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let root: Root | undefined;
let container: HTMLDivElement;

const content = {
  v: 1,
  bidYear: 2027,
  settings: null,
  notes: { bid: 'Synthetic Blueprint notes', positions: null },
  policy: null,
  planning: null,
  authoring: null,
  positions: [
    {
      id: 'synthetic-position-1',
      shift: 'A',
      station: '7',
      division: 'Combat',
      unit: 'Synthetic Engine',
      rankRequired: 'FF',
      positionName: 'Synthetic firefighter',
      isExcludedFromCount: false,
      isFloating: false,
      isVacantByDesign: false,
    },
  ],
  rules: [],
  participation: [],
  staffingBindings: [
    {
      positionId: 'synthetic-position-1',
      staffingPositionId: 'synthetic-staffing-position-1',
      authoritativeSourceRef: 'Synthetic approved organization evidence',
      reviewStatus: 'approved',
    },
  ],
  sourceDecisions: [
    {
      issueId: 'synthetic-open-source-decision',
      title: 'Synthetic open source decision',
      question: 'Which source applies?',
      area: 'rules',
      status: 'OPEN',
      decision: '',
      sourceRef: 'Synthetic source review',
      effectiveOn: '2027-01-01',
    },
  ],
} as BidDefinitionContent;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function required<T>(value: T | null | undefined, message = 'Expected an element.') {
  if (!value) throw new Error(message);
  return value;
}

function control(label: string) {
  return required(
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === label,
    ),
    `Missing ${label} control.`,
  );
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<BidBlueprint content={content} />));
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function keydown(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('Bid Blueprint', () => {
  it('distinguishes authored structure from server facts and exposes keyboard-operable tab panels', async () => {
    await render();

    const lensList = required(container.querySelector<HTMLElement>('[role="tablist"]'));
    expect(container.textContent).toContain('authored/local Bid structure');
    expect(container.textContent).toContain('separately labeled server Preview or impact facts');
    expect(lensList.textContent).toContain('Overview');
    expect(lensList.textContent).toContain('Flow');
    expect(lensList.textContent).toContain('Policy');
    expect(lensList.textContent).toContain('Specialty');
    expect(lensList.textContent).toContain('Opportunities');
    expect(lensList.textContent).toContain('Members');
    expect(lensList.textContent).toContain('Changes');
    const overview = control('Overview');
    const flow = control('Flow');
    const changes = control('Changes');
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(overview.getAttribute('tabindex')).toBe('0');
    expect(flow.getAttribute('tabindex')).toBe('-1');
    const overviewPanel = required(
      document.getElementById(required(overview.getAttribute('aria-controls'))),
      'Missing Overview tab panel.',
    );
    expect(overviewPanel.getAttribute('role')).toBe('tabpanel');
    expect(overviewPanel.getAttribute('aria-labelledby')).toBe(overview.id);
    expect(overviewPanel.hidden).toBe(false);
    const tabs = [...lensList.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels).toHaveLength(tabs.length);
    for (const tab of tabs) {
      const panel = required(
        document.getElementById(required(tab.getAttribute('aria-controls'))),
        `Missing panel for ${tab.textContent}.`,
      );
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    expect(panels.filter((panel) => !panel.hidden)).toHaveLength(1);

    await keydown(overview, 'ArrowRight');
    expect(document.activeElement).toBe(flow);
    expect(flow.getAttribute('aria-selected')).toBe('true');
    expect(flow.getAttribute('tabindex')).toBe('0');
    expect(overview.getAttribute('tabindex')).toBe('-1');

    await keydown(flow, 'End');
    expect(document.activeElement).toBe(changes);
    expect(changes.getAttribute('aria-selected')).toBe('true');
    await keydown(changes, 'Home');
    expect(document.activeElement).toBe(overview);
    expect(overview.getAttribute('aria-selected')).toBe('true');
    await keydown(overview, 'ArrowLeft');
    expect(document.activeElement).toBe(changes);
    expect(changes.getAttribute('aria-selected')).toBe('true');
    await keydown(changes, 'Home');
    expect(document.activeElement).toBe(overview);
    expect(overview.getAttribute('aria-selected')).toBe('true');

    expect(
      required(container.querySelector('section[aria-label="Bid relationship map"]')),
    ).toBeTruthy();
    expect(
      required(container.querySelector('section[aria-label="Blueprint inspector"]')),
    ).toBeTruthy();
    expect(control('Zoom in').getAttribute('aria-label')).toContain('Zoom in');
    expect(control('Zoom out').getAttribute('aria-label')).toContain('Zoom out');
    expect(control('Reset zoom').getAttribute('aria-label')).toContain('Reset zoom');
    expect(required(container.querySelector('output')).textContent).toContain('Zoom: 100%');
    expect(container.textContent).toContain('Structured relationship list');

    const nodes = container.querySelectorAll<HTMLButtonElement>('[data-bid-visual-node]');
    expect(nodes.length).toBeGreaterThan(0);
    const authoredNode = required(
      [...nodes].find((node) => node.textContent?.includes('AUTHORED')),
      'Expected a visibly authored structural node.',
    );
    expect(authoredNode.textContent).toContain('AUTHORED');
    const firstNode = required(nodes.item(0));
    await click(firstNode);
    expect(firstNode.getAttribute('aria-pressed')).toBe('true');
    expect(
      required(container.querySelector('section[aria-label="Blueprint inspector"]')).textContent,
    ).toContain(required(firstNode.querySelector('span')).textContent ?? '');

    await click(control('Specialty'));
    expect(control('Specialty').getAttribute('aria-selected')).toBe('true');
    expect(control('Overview').getAttribute('aria-selected')).toBe('false');

    await click(control('Zoom in'));
    expect(container.textContent).toContain('110%');
  });
});
