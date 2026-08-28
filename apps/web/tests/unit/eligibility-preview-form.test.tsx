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
    root.render(<EligibilityPreviewForm />);
  });

  const form = container.querySelector('form');
  const memberId = container.querySelector<HTMLInputElement>(
    '[data-testid="eligibility-member-id"]',
  );
  const positionId = container.querySelector<HTMLInputElement>(
    '[data-testid="eligibility-position-id"]',
  );
  const ruleBookVersion = container.querySelector<HTMLInputElement>(
    '[data-testid="eligibility-rule-book-version"]',
  );
  if (!form || !memberId || !positionId || !ruleBookVersion) {
    throw new Error('Eligibility preview controls did not render.');
  }

  return { container, form, memberId, positionId, ruleBookVersion };
}

async function setInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
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

describe('EligibilityPreviewForm', () => {
  it('does not send a preview request when no explicit rule-book version is selected', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { container, form, memberId, positionId, ruleBookVersion } = renderForm();
    await setInput(memberId, '80');
    await setInput(positionId, 'A205');

    expect(ruleBookVersion.required).toBe(true);
    expect(ruleBookVersion.value).toBe('');

    await submit(form);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('An explicit rule-book version is required.');
  });

  it('forwards the explicitly selected rule-book version with the preview request', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ eligible: true, reasons: [], points: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { form, memberId, positionId, ruleBookVersion } = renderForm();
    await setInput(memberId, '80');
    await setInput(positionId, 'A205');
    await setInput(ruleBookVersion, '2026.2');

    await submit(form);

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error('Eligibility preview request did not include request options.');
    expect(JSON.parse(String(request.body))).toEqual({
      member_id: 80,
      position_id: 'A205',
      rule_book_version: '2026.2',
    });
  });
});
