// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnualPolicyPublishGate } from '../../app/admin/annual-policy/AnnualPolicyPublishGate';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

function renderGate(onConfirm: (reason: string) => Promise<boolean>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(<AnnualPolicyPublishGate busy={false} onConfirm={onConfirm} />);
  });

  return container;
}

describe('AnnualPolicyPublishGate', () => {
  it('requires a reviewed reason in an in-page dialog before publication', async () => {
    const onConfirm = vi.fn(async () => true);
    const container = renderGate(onConfirm);
    const openButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Publish revision',
    );
    if (!openButton) throw new Error('Publish control did not render.');

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => openButton.click());

    const dialog = document.querySelector('[role="dialog"]');
    const reason = dialog?.querySelector('textarea');
    const confirmButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Request server-side publication review',
    );
    if (!dialog || !reason || !confirmButton) {
      throw new Error('Publication review dialog controls did not render.');
    }

    expect(dialog.textContent).toContain('Publication gate for annual policy');
    expect(confirmButton.disabled).toBe(true);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      if (!valueSetter) throw new Error('Textarea value setter is unavailable.');
      valueSetter.call(reason, 'Owner-reviewed annual policy publication.');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const enabledConfirmButton = [...(dialog.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Request server-side publication review',
    );
    if (!enabledConfirmButton) throw new Error('Publication confirmation control disappeared.');
    expect(enabledConfirmButton.disabled).toBe(false);

    await act(async () => {
      enabledConfirmButton.click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith('Owner-reviewed annual policy publication.');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
