import { describe, expect, it, vi } from 'vitest';

import { createCsrfAwareFetch } from '../../lib/client-csrf';

const csrfToken = 'csrf_123e4567-e89b-12d3-a456-426614174000';
const origin = 'https://staging.bid.mbfdhub.com';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createCsrfAwareFetch', () => {
  it('bootstraps once and adds the double-submit header to unsafe admin multipart requests', async () => {
    const originalFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf') return response({ token: csrfToken });
      return response({ ok: true });
    });
    const csrfFetch = createCsrfAwareFetch(originalFetch as typeof fetch, () => origin);
    const formData = new FormData();
    formData.append('file', new Blob(['credential rows']), 'credentials.csv');

    await csrfFetch('/api/admin/credentials-import', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'import-1' },
      body: formData,
    });
    await csrfFetch('/api/admin/credentials-import', {
      method: 'POST',
      body: formData,
    });

    expect(originalFetch).toHaveBeenCalledTimes(3);
    expect(originalFetch).toHaveBeenNthCalledWith(
      1,
      '/api/auth/csrf',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store' }),
    );
    const firstWrite = originalFetch.mock.calls[1];
    expect(firstWrite?.[0]).toBe('/api/admin/credentials-import');
    expect(firstWrite?.[1]?.body).toBe(formData);
    const firstHeaders = new Headers(firstWrite?.[1]?.headers);
    expect(firstHeaders.get('X-MBFD-CSRF')).toBe(csrfToken);
    expect(firstHeaders.get('Idempotency-Key')).toBe('import-1');
    expect(new Headers(originalFetch.mock.calls[2]?.[1]?.headers).get('X-MBFD-CSRF')).toBe(
      csrfToken,
    );
  });

  it('also protects bid proxy writes and ticket issuance without adding a header to safe or unrelated requests', async () => {
    const originalFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf') return response({ token: csrfToken });
      return response({ ok: true });
    });
    const csrfFetch = createCsrfAwareFetch(originalFetch as typeof fetch, () => origin);

    await csrfFetch('/api/bid/a-day-pick', { method: 'POST' });
    await csrfFetch('/api/auth/ws-ticket', { method: 'POST' });
    await csrfFetch('/api/admin/credentials', { method: 'GET' });
    await csrfFetch('/api/auth/logout', { method: 'POST' });

    expect(originalFetch).toHaveBeenCalledTimes(5);
    expect(new Headers(originalFetch.mock.calls[1]?.[1]?.headers).get('X-MBFD-CSRF')).toBe(
      csrfToken,
    );
    expect(new Headers(originalFetch.mock.calls[2]?.[1]?.headers).get('X-MBFD-CSRF')).toBe(
      csrfToken,
    );
    expect(originalFetch.mock.calls[3]?.[1]?.headers).toBeUndefined();
    expect(originalFetch.mock.calls[4]?.[1]?.headers).toBeUndefined();
  });

  it('fails closed when the bootstrap response does not contain a valid nonce', async () => {
    const originalFetch = vi.fn(async () => response({ token: 'bad-token' }));
    const csrfFetch = createCsrfAwareFetch(originalFetch as typeof fetch, () => origin);

    await expect(csrfFetch('/api/admin/bid/skip', { method: 'POST' })).rejects.toThrow(
      'csrf_bootstrap_failed',
    );
    expect(originalFetch).toHaveBeenCalledTimes(1);
  });
});
