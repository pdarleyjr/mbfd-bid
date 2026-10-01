// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createCsrfAwareFetch } from '../../lib/client-csrf';
import { BEFORE_OPERATOR_COMMAND, notifyOperatorAuthRefreshed } from '../../lib/operator-step-up';

describe('operator CSRF recovery boundary', () => {
  it('acquires a fresh nonce after verified reauthentication while preserving the deliberate request identity and body', async () => {
    const first = 'csrf_123e4567-e89b-12d3-a456-426614174000';
    const second = 'csrf_123e4567-e89b-12d3-a456-426614174001';
    let nonce = first;
    const original = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(String(input) === '/api/auth/csrf' ? { token: nonce } : { ok: true }),
    );
    const captured = createCsrfAwareFetch(original as typeof fetch, () => window.location.origin);
    const init = {
      method: 'POST',
      body: '{"expectedSeq":7}',
      headers: { 'Idempotency-Key': 'reviewed-command' },
    };
    await captured('/api/admin/bid-session/synthetic/command', init);
    nonce = second;
    notifyOperatorAuthRefreshed();
    expect(original).toHaveBeenCalledTimes(2);
    await captured('/api/admin/bid-session/synthetic/command', init);
    expect(original).toHaveBeenCalledTimes(4);
    const sent = original.mock.calls[3] as unknown as [RequestInfo, RequestInit];
    expect(sent[1].body).toBe(init.body);
    expect(new Headers(sent[1].headers).get('Idempotency-Key')).toBe('reviewed-command');
    expect(new Headers(sent[1].headers).get('X-MBFD-CSRF')).toBe(second);
  });
  it('does not forward a command whose freshness expires during the nonce request', async () => {
    let pending = false;
    const rejectPending = (event: Event) => {
      if (pending) event.preventDefault();
    };
    window.addEventListener(BEFORE_OPERATOR_COMMAND, rejectPending);
    const original = vi.fn(async () => {
      pending = true;
      return Response.json({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' });
    });
    try {
      const captured = createCsrfAwareFetch(original as typeof fetch, () => window.location.origin);
      expect(
        (await captured('/api/admin/bid-session/synthetic/command', { method: 'POST' })).status,
      ).toBe(401);
      expect(original).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(BEFORE_OPERATOR_COMMAND, rejectPending);
    }
  });
});
