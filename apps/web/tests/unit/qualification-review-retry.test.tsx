// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';
import { QualificationReviewWorkspace } from '../../app/admin/personnel/reviews/QualificationReviewWorkspace';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

it('retries batch creation, row staging and explicit apply with their original request identities', async () => {
  const attempts: { url: string; init: RequestInit }[] = [];
  let applied = false;
  const batch = {
    id: 'synthetic-batch',
    source_system: 'synthetic',
    source_reference: 'fixture',
    status: 'staged',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/auth/csrf')
        return Response.json({ token: 'csrf_11111111-1111-1111-1111-111111111111' });
      if (init?.method !== 'POST')
        return Response.json({
          batch,
          annualEligibility: 'PENDING_CONFIGURATION',
          rows: [
            {
              id: 'synthetic-row',
              sourceMemberReference: 'synthetic-member',
              sourceCredentialReference: 'synthetic-credential',
              sourceStatus: 'active',
              effectiveOn: '2027-01-01',
              expiresOn: null,
              provenance: 'Synthetic reviewed fixture',
              classification: 'matched',
              decision: 'accepted',
              appliedEventId: applied ? 'synthetic-event' : null,
            },
          ],
        });
      attempts.push({ url, init });
      if (attempts.filter((r) => r.url === url).length === 1)
        throw new TypeError('Synthetic response loss');
      if (url.endsWith('/apply')) applied = true;
      return Response.json({ batchId: batch.id, replayed: true });
    }),
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AdminQueryProvider>
          <QualificationReviewWorkspace initialBatches={[]} />
        </AdminQueryProvider>,
      ),
    );
    const values = [
      'synthetic',
      'fixture',
      'synthetic-member',
      'synthetic-credential',
      '2027-01-01',
      '',
      'Synthetic reviewed fixture',
    ];
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('form input'));
    expect(inputs).toHaveLength(values.length);
    for (const [index, input] of inputs.entries()) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          values[index],
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const form = container.querySelector('form');
    if (!form) throw new Error('Missing stage form');
    const submit = async () =>
      act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    await submit();
    expect(container.textContent).toContain('Synthetic response loss');
    await submit();
    expect(container.textContent).toContain('Synthetic response loss');
    await submit();
    expect(container.textContent).toContain('The source row is staged');
    const apply = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Explicit apply',
    );
    if (!apply) throw new Error('Missing explicit apply button');
    await act(async () => apply.click());
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => apply.click());
    expect(router.refresh).toHaveBeenCalledTimes(1);
    for (const [suffix, count] of [
      ['/batches', 3],
      ['/rows', 2],
      ['/apply', 2],
    ] as const) {
      const group = attempts.filter((r) => r.url.endsWith(suffix));
      expect(group).toHaveLength(count);
      expect(
        new Set(group.map((r) => new Headers(r.init.headers).get('Idempotency-Key'))).size,
      ).toBe(1);
      expect(new Set(group.map((r) => r.init.body)).size).toBe(1);
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
