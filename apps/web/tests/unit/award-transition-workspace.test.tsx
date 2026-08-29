// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AwardTransitionOperatorContext,
  AwardTransitionWorkspace,
} from '../../app/admin/award-transition/AwardTransitionWorkspace';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const operatorContext: AwardTransitionOperatorContext = {
  sessionId: 'completed-bid-7',
  sessionLabel: '2026 completed annual Bid',
  members: {
    7: 'Avery Operator · FF',
  },
  bidPositions: {
    'bid-position-1': 'A205 · Engine 2 Lieutenant',
  },
  staffingPositions: {
    'staffing-old': 'Station 1 · Engine 1 · Firefighter',
    'staffing-new': 'Station 2 · Engine 2 · Lieutenant',
  },
};

function renderWorkspace(
  context: AwardTransitionOperatorContext | null = operatorContext,
): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<AwardTransitionWorkspace operatorContext={context} />);
  });
  return container;
}

async function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Input value setter is unavailable.');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(control: HTMLElement) {
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('AwardTransitionWorkspace', () => {
  it('keeps award transition fail-closed until a completed Bid is selected from its operator controls', () => {
    const html = renderToString(<AwardTransitionWorkspace operatorContext={null} />);

    expect(html).toContain('Award transition');
    expect(html).toContain('Select a completed Bid from its session controls');
    expect(html).toContain('Preview is read-only');
    expect(html).toContain('Mock sessions are blocked');
    expect(html).toContain('complete, immutable Bid snapshot');
    expect(html).not.toContain('Bid session ID');
    expect(html).not.toContain('Completed Bid session identifier');
    expect(html).not.toContain('data-testid="award-transition-preview-form"');
  });

  it('displays a Worker block reason without exposing application controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'mock_session_not_transitionable' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const container = renderWorkspace();
    const previewForm = container.querySelector<HTMLFormElement>(
      '[data-testid="award-transition-preview-form"]',
    );
    const effectiveOn = container.querySelector<HTMLInputElement>('input[type="date"]');
    if (!previewForm || !effectiveOn) throw new Error('Preview controls did not render.');

    await setInput(effectiveOn, '2099-01-02');
    await submit(previewForm);

    expect(container.textContent).toContain('Transition blocked: mock_session_not_transitionable.');
    expect(container.querySelector('[data-testid="award-transition-apply-form"]')).toBeNull();
  });

  it('shows the reviewed plan, transition CSV, and guarded application receipt only after preview', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url = String(input);
        if (url.includes('/preview?')) {
          return new Response(
            JSON.stringify({
              transition: {
                bidSessionId: 'completed-bid-7',
                asOfDate: '2026-08-28',
                effectiveOn: '2099-01-02',
                assignmentClosures: [
                  {
                    id: 'prior-assignment-1',
                    memberId: 7,
                    staffingPositionId: 'staffing-old',
                    status: 'active',
                    effectiveTo: '2099-01-01',
                  },
                ],
                plannedAssignments: [
                  {
                    awardId: 'award-1',
                    memberId: 7,
                    positionId: 'bid-position-1',
                    staffingPositionId: 'staffing-new',
                    originType: 'BID_AWARD',
                    originRef: 'bid-award:completed-bid-7:award-1',
                    status: 'planned',
                    effectiveFrom: '2099-01-02',
                    effectiveTo: null,
                  },
                ],
                currentToNew: [
                  {
                    ordinal: 1,
                    awardId: 'award-1',
                    memberId: 7,
                    positionId: 'bid-position-1',
                    currentAssignment: {
                      id: 'prior-assignment-1',
                      staffingPositionId: 'staffing-old',
                      status: 'active',
                      effectiveFrom: '2026-01-01',
                      effectiveTo: null,
                    },
                    newAssignment: {
                      staffingPositionId: 'staffing-new',
                      effectiveFrom: '2099-01-02',
                      originRef: 'bid-award:completed-bid-7:award-1',
                      status: 'planned',
                    },
                  },
                ],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.endsWith('/apply')) {
          expect(init?.method).toBe('POST');
          return new Response(
            JSON.stringify({
              replayed: false,
              effectiveOn: '2099-01-02',
              createdAssignments: 1,
              lifecycleEventIds: ['lifecycle-1'],
              portalWriteback: 'not_enqueued',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace();
    const previewForm = container.querySelector<HTMLFormElement>(
      '[data-testid="award-transition-preview-form"]',
    );
    const effectiveOn = container.querySelector<HTMLInputElement>('input[type="date"]');
    if (!previewForm || !effectiveOn) throw new Error('Preview controls did not render.');

    await setInput(effectiveOn, '2099-01-02');
    await submit(previewForm);

    expect(container.textContent).toContain('Current-to-new assignments');
    expect(container.textContent).toContain('Avery Operator');
    expect(container.textContent).toContain('A205 · Engine 2 Lieutenant');
    expect(container.textContent).toContain('Station 1 · Engine 1 · Firefighter');
    expect(container.textContent).toContain('Station 2 · Engine 2 · Lieutenant');
    expect(container.textContent).not.toContain('staffing-old');
    expect(container.textContent).not.toContain('staffing-new');
    const csv = container.querySelector<HTMLAnchorElement>('[data-testid="award-transition-csv"]');
    expect(csv?.getAttribute('href')).toBe(
      '/api/admin/bid-award-transition/completed-bid-7/transition.csv?effective_on=2099-01-02',
    );

    const applyForm = container.querySelector<HTMLFormElement>(
      '[data-testid="award-transition-apply-form"]',
    );
    const reason = container.querySelector<HTMLTextAreaElement>('textarea');
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const applyButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Apply reviewed transition'),
    );
    if (!applyForm || !reason || !confirmation || !applyButton) {
      throw new Error('Guarded transition controls did not render after preview.');
    }
    expect(applyButton.disabled).toBe(true);

    await setInput(reason, 'Reviewed final awards with Battalion Chief before effective date.');
    await click(confirmation);
    expect(applyButton.disabled).toBe(false);
    await submit(applyForm);

    const applyCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/apply'));
    if (!applyCall) throw new Error('Application request was not sent.');
    const headers = new Headers(applyCall[1]?.headers);
    expect(headers.get('Idempotency-Key')).toBeTruthy();
    expect(JSON.parse(String(applyCall[1]?.body))).toEqual({
      effective_on: '2099-01-02',
      reason: 'Reviewed final awards with Battalion Chief before effective date.',
    });
    expect(container.textContent).toContain('Future staffing transition recorded');
    expect(container.textContent).toContain('Portal writeback was not enqueued');
  });
});
