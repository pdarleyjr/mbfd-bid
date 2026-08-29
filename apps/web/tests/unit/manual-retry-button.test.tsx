// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManualRetryButton } from '../../app/admin/exports/_components/ManualRetryButton';

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

function renderButton(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<ManualRetryButton bidId="synthetic-bid-7" />);
  });
  return container;
}

async function click(control: HTMLButtonElement): Promise<void> {
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ManualRetryButton', () => {
  it('reports a non-OK retry response and never claims it was queued', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const container = renderButton();
    const button = container.querySelector('button');
    if (!button) throw new Error('Manual retry button did not render.');

    await click(button);

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/portal-retry/synthetic-bid-7', {
      method: 'POST',
      credentials: 'include',
    });
    expect(button.textContent).toBe('Retry');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Retry failed (503)');
    expect(container.textContent).not.toContain('Queued');
  });

  it('shows queued only after a successful retry response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 202 })),
    );

    const container = renderButton();
    const button = container.querySelector('button');
    if (!button) throw new Error('Manual retry button did not render.');

    await click(button);

    expect(button.textContent).toBe('Queued');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
