// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReviewedBidAdjustment } from '../../app/admin/bid/_components/ReviewedBidAdjustment';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

it('confirms the exact reviewed score receipt and safely retries the same adjustment', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const originalFetch = globalThis.fetch;
  const originalWindowFetch = window.fetch;
  const commands: Record<string, unknown>[] = [];
  let receiptSha256 = 'a'.repeat(64);
  let loseFirstResponse = true;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/csrf')
      return new Response(JSON.stringify({ token: 'csrf_00000000-0000-0000-0000-000000000001' }));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url.endsWith('/preview'))
      return new Response(
        JSON.stringify({
          valid: true,
          expectedSeq: 7,
          scoreReceiptSha256: receiptSha256,
          warnings: [],
        }),
      );
    commands.push(body);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new Error('Response lost after delivery');
    }
    return new Response(JSON.stringify({ kind: 'accepted' }));
  });
  globalThis.fetch = fetcher;
  window.fetch = fetcher;
  const click = async (label: string) => {
    await act(async () => {
      const button = [...host.querySelectorAll('button')].find(
        (node) => node.textContent === label,
      );
      if (!button) throw new Error(`Button missing: ${label}`);
      button.click();
    });
  };
  try {
    await act(async () => {
      root.render(
        <ReviewedBidAdjustment
          sessionId="synthetic-reviewed-adjustment"
          sequence={7}
          detail={{ type: 'live.disposition', memberId: 17, disposition: 'SKIP' }}
          reason=""
          disabled={false}
          label="Adjustment"
          onSaved={vi.fn()}
        />,
      );
    });
    await click('Review adjustment');
    await act(async () => {
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    receiptSha256 = 'b'.repeat(64);
    await click('Confirm adjustment');
    await click('Confirm adjustment');
    expect(commands).toHaveLength(2);
    expect(commands[0]?.expectedScoreReceiptSha256).toBe('a'.repeat(64));
    expect(commands[1]).toEqual(commands[0]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = originalFetch;
    window.fetch = originalWindowFetch;
  }
});
