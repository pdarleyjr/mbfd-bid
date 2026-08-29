// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EligibilityPreviewForm } from '../../app/admin/eligibility/EligibilityPreviewForm';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.unstubAllGlobals();
});

function renderForm() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(
      <EligibilityPreviewForm
        ruleBookVersion="2027.2"
        positionTemplateVersion="2027.1"
        members={[{ id: 80, firstName: 'Jamie', lastName: 'Rivera', rank: 'LT' }]}
        positions={[
          {
            id: 'A205',
            positionName: 'Engine Driver',
            station: 'Station 2',
            unit: 'E2',
            rankRequired: 'LT',
          },
        ]}
      />,
    );
  });

  const form = container.querySelector('form');
  const memberId = container.querySelector(
    '[data-testid="eligibility-member-id"]',
  ) as HTMLSelectElement | null;
  const positionId = container.querySelector(
    '[data-testid="eligibility-position-id"]',
  ) as HTMLSelectElement | null;
  const ruleBookVersion = container.querySelector<HTMLOutputElement>(
    '[data-testid="eligibility-rule-book-version"]',
  );
  if (!form || !memberId || !positionId || !ruleBookVersion) {
    throw new Error('Eligibility preview controls did not render.');
  }

  return { container, form, memberId, positionId, ruleBookVersion };
}

async function setInput(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Input value setter is unavailable.');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('EligibilityPreviewForm', () => {
  it('does not send a preview request until a human-readable member and selected-template position are chosen', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { container, form, ruleBookVersion } = renderForm();
    expect(ruleBookVersion.textContent).toBe('2027.2');
    expect(container.textContent).toContain('Selected annual configuration');
    expect(container.textContent).toContain('2027.1');

    await submit(form);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Select a member from the configured roster.');
  });

  it('forwards the configuration-bound rule-book version with the preview request', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ eligible: true, reasons: [], points: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { form, memberId, positionId } = renderForm();
    await setInput(memberId, '80');
    await setInput(positionId, 'A205');

    await submit(form);

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error('Eligibility preview request did not include request options.');
    expect(JSON.parse(String(request.body))).toEqual({
      member_id: 80,
      position_id: 'A205',
      rule_book_version: '2027.2',
    });
  });
});
