import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cfEnv: vi.fn(),
  cookies: vi.fn(),
  fetch: vi.fn(),
  getWorkerBase: vi.fn(() => 'https://api.staging.bid.mbfdhub.com'),
  requireAdmin: vi.fn(),
}));

const csrfToken = 'csrf_123e4567-e89b-12d3-a456-426614174000';

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: mocks.getWorkerBase }));
vi.mock('@/lib/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));

function request({
  path,
  origin = 'https://staging.bid.mbfdhub.com',
  fetchSite = 'same-origin',
  csrf = csrfToken,
}: {
  path: string;
  origin?: string | null;
  fetchSite?: string | null;
  csrf?: string | null;
}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (origin !== null) headers.set('Origin', origin);
  if (fetchSite !== null) headers.set('Sec-Fetch-Site', fetchSite);
  if (csrf !== null) headers.set('X-MBFD-CSRF', csrf);
  return new Request(`https://staging.bid.mbfdhub.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ example: true }),
  });
}

describe('cookie-authenticated admin mutation CSRF enforcement', () => {
  beforeEach(() => {
    mocks.cfEnv.mockImplementation((key: string) => (key === 'ENV' ? 'staging' : undefined));
    mocks.cookies.mockReset();
    mocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) => {
        if (name === 'mbfd_bid_jwt') return { value: 'session-jwt' };
        if (name === 'mbfd_bid_csrf') return { value: csrfToken };
        return undefined;
      }),
    });
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    mocks.requireAdmin.mockReset();
    mocks.requireAdmin.mockResolvedValue({ role: 'admin', sub: 1 });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it.each([
    ['foreign Origin', 'https://evil.example', 'cross-site'],
    ['missing Origin', null, 'same-origin'],
    ['cross-site Fetch Metadata', 'https://staging.bid.mbfdhub.com', 'cross-site'],
    ['same-site Fetch Metadata', 'https://staging.bid.mbfdhub.com', 'same-site'],
  ])(
    'rejects an unsafe generic admin proxy request with %s before reading a cookie or contacting the Worker',
    async (_label, origin, fetchSite) => {
      const { POST } = await import('../../app/api/admin/[...path]/route');
      const response = await POST(request({ path: '/api/admin/bid/skip', origin, fetchSite }), {
        params: Promise.resolve({ path: ['bid', 'skip'] }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'csrf_origin_forbidden' });
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects a cross-origin credential multipart upload before admin verification or form parsing', async () => {
    const { POST } = await import('../../app/api/admin/credentials-import/route');

    const response = await POST(
      request({
        path: '/api/admin/credentials-import',
        origin: 'https://evil.example',
        fetchSite: 'cross-site',
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'csrf_origin_forbidden' });
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('allows a same-origin generic admin mutation, including clients without Fetch Metadata', async () => {
    const { POST } = await import('../../app/api/admin/[...path]/route');
    const response = await POST(request({ path: '/api/admin/bid/skip', fetchSite: null }), {
      params: Promise.resolve({ path: ['bid', 'skip'] }),
    });

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.staging.bid.mbfdhub.com/api/admin/bid/skip',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ get: expect.any(Function) }),
      }),
    );
    const upstreamHeaders = mocks.fetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(upstreamHeaders.get('authorization')).toBe('Bearer session-jwt');
  });

  it.each([
    ['missing CSRF header', null],
    ['mismatched CSRF header', 'different-csrf-token'],
  ])(
    'rejects a same-origin admin mutation with %s before contacting the Worker',
    async (_label, csrf) => {
      const { POST } = await import('../../app/api/admin/[...path]/route');
      const response = await POST(request({ path: '/api/admin/bid/skip', csrf }), {
        params: Promise.resolve({ path: ['bid', 'skip'] }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'csrf_token_forbidden' });
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
});
