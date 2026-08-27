// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BidPinForm } from '../../app/admin/settings/bid-pin/BidPinForm';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <BidPinForm
          initial={{
            configured: true,
            pin: '2300',
            updatedAt: '2026-08-27T00:00:00.000Z',
            updatedBy: 'admin',
          }}
        />
      </QueryClientProvider>,
    );
  });
  return container;
}

describe('BidPinForm', () => {
  it('updates the displayed current PIN immediately after a successful save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          return new Response(
            JSON.stringify({
              configured: true,
              pin: '2301',
              updatedAt: '2026-08-27T00:00:01.000Z',
              updatedBy: 'admin',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            configured: true,
            pin: '2300',
            updatedAt: '2026-08-27T00:00:00.000Z',
            updatedBy: 'admin',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const container = renderForm();
    const input = container.querySelector<HTMLInputElement>('[data-testid="bid-pin-input"]');
    const form = container.querySelector('form');
    if (!input || !form) throw new Error('Bid PIN form controls did not render.');

    await act(async () => {
      input.value = '2301';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="current-bid-pin"]')?.textContent).toBe('2301');
    expect(container.querySelector('[data-testid="bid-pin-status"]')?.textContent).toContain(
      'Saved at',
    );
  });
});
