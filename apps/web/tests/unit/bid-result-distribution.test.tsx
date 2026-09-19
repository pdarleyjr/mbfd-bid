// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidResultDistribution } from '../../app/admin/current-bid/BidResultDistribution';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
const hash = 'a'.repeat(64);
function projection(saved = false) {
  return {
    sessionId: 'synthetic-live',
    completion: { revision: 12, commandId: 'completed', completedAtMs: 1 },
    packageSha256: hash,
    status: 'EXTERNAL_PUBLICATION_REQUIRED',
    externalDeliveryPerformed: false,
    channels: [
      {
        channel: 'EMAIL',
        review: saved
          ? {
              revision: 1,
              status: 'COMPLETED',
              published_on: '2027-02-02',
              evidence_ref: 'Synthetic sent message',
              actor_subject: '99',
            }
          : null,
      },
      { channel: 'TARGETSOLUTIONS', review: null },
    ],
  };
}
async function settle(action = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(isMock = false, completionVerified = true) {
  await settle(() =>
    root.render(
      <BidResultDistribution
        sessionId="synthetic-live"
        isMock={isMock}
        completionVerified={completionVerified}
      />,
    ),
  );
}
function button(text: string) {
  const value = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!value) throw new Error(`Missing button: ${text}`);
  return value;
}
async function field(text: string, value: string) {
  const node = [...container.querySelectorAll('label')]
    .find((item) => item.textContent?.startsWith(text))
    ?.querySelector('input');
  if (!node) throw new Error(`Missing field: ${text}`);
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetcher = vi.fn(async () => Response.json(projection()));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('manual result distribution UI', () => {
  it('requires explicit generation and labels external work without claiming delivery', async () => {
    await mount();
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.textContent).toContain('External publication required');
    expect(container.textContent).toContain('does not send or publish');
    await settle(() => button('Generate final result package').click());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const generatedRequest = fetcher.mock.calls[0];
    if (!generatedRequest) throw new Error('Expected package request');
    expect(generatedRequest[1].method).toBeUndefined();
    expect(container.querySelector(`a[href$="package/json?sha256=${hash}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href$="package/csv?sha256=${hash}"]`)).not.toBeNull();
    expect(container.textContent).toContain('Evidence required');
  });

  it('preserves evidence body and request key after response loss and sends CSRF token', async () => {
    const writes: { body: string; key: string | null; csrf: string | null }[] = [];
    let saved = false;
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf')
        return Response.json({ token: 'csrf_11111111-1111-1111-1111-111111111111' });
      if (init?.method === 'POST') {
        const headers = new Headers(init.headers);
        writes.push({
          body: String(init.body),
          key: headers.get('Idempotency-Key'),
          csrf: headers.get('X-MBFD-CSRF'),
        });
        saved = true;
        if (writes.length === 1) throw new TypeError('Synthetic response lost');
        return Response.json({ replayed: true });
      }
      return Response.json(projection(saved));
    });
    await mount();
    await settle(() => button('Generate final result package').click());
    await field('External publication date', '2027-02-02');
    await field('Evidence reference', 'Synthetic sent message');
    await field('Review reason', 'Reviewed synthetic distribution');
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!confirmation) throw new Error('Confirmation missing');
    await settle(() => confirmation.click());
    await settle(() => button('Record reviewed evidence').click());
    expect(container.textContent).toContain('Synthetic response lost');
    await settle(() => button('Record reviewed evidence').click());
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
    const firstWrite = writes[0];
    if (!firstWrite) throw new Error('Expected evidence write');
    expect(firstWrite.key).toBeTruthy();
    expect(firstWrite.csrf).toBe('csrf_11111111-1111-1111-1111-111111111111');
    expect(JSON.parse(firstWrite.body)).toMatchObject({
      expectedCompletionSeq: 12,
      packageSha256: hash,
      expectedRevision: 0,
      channel: 'EMAIL',
      status: 'COMPLETED',
    });
    expect(container.textContent).toContain(
      'Completion evidence reviewed — Synthetic sent message',
    );
    expect(container.textContent).toContain(
      'External publication still requires completed evidence for each channel',
    );
  });

  it('offers no official distribution for Mock and disables incomplete Live generation', async () => {
    await mount(true, false);
    expect(container.textContent).toContain('unavailable for Mock');
    expect(container.textContent).not.toContain('Generate final result package');
    expect(button('Preview rehearsal assignments')).toBeDefined();
    await mount(false, false);
    expect(button('Generate final result package').disabled).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('loads only an explicit read-only Mock projection and refuses a mismatched run', async () => {
    const preview = {
      sessionId: 'synthetic-live',
      mode: 'MOCK',
      canApply: false,
      status: 'REHEARSAL_PROJECTION_ONLY',
      completion: { revision: 18 },
      projectedAssignments: [
        {
          memberId: 91001,
          shift: 'A',
          station: '1',
          unit: 'Synthetic capacity',
          position: 'Synthetic seat',
          aDay: 'G1',
        },
      ],
      finalization: { complete: true, blockers: [] },
      applicationBlockers: ['mock_session_not_transitionable'],
    };
    fetcher.mockImplementation(async () => Response.json(preview));
    await mount(true);
    expect(fetcher).not.toHaveBeenCalled();
    await settle(() => button('Preview rehearsal assignments').click());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const previewRequest = fetcher.mock.calls[0];
    if (!previewRequest) throw new Error('Expected preview request');
    expect(previewRequest[0]).toBe(
      '/api/admin/result-distribution/synthetic-live/rehearsal-transition-preview',
    );
    expect(previewRequest[1].method).toBeUndefined();
    expect(container.textContent).toContain('1 projected assignments');
    expect(container.textContent).toContain('Official assignment transition remains blocked');
    expect(container.querySelector('form')).toBeNull();
    fetcher.mockImplementation(async () =>
      Response.json({ ...preview, sessionId: 'different-run' }),
    );
    await settle(() => button('Preview rehearsal assignments').click());
    expect(container.textContent).toContain('Preview does not match selected Mock');
    expect(container.textContent).not.toContain('1 projected assignments');
  });
});
