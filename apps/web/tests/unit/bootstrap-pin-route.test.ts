import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cfEnv: vi.fn(),
  fetch: vi.fn(),
  getWorkerBase: vi.fn(() => 'https://api.staging.bid.mbfdhub.com'),
  verifyJwt: vi.fn(async () => ({ role: 'admin', sub: 0, emp: 'admin' })),
}));

vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: mocks.getWorkerBase }));
vi.mock('@/lib/jwt', () => ({ verifyJwt: mocks.verifyJwt }));

function request(headers: HeadersInit = {}) {
  return new Request('https://staging.bid.mbfdhub.com/api/auth/bootstrap-pin', {
    method: 'POST',
    headers: {
      Origin: 'https://staging.bid.mbfdhub.com',
      'Sec-Fetch-Site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ password: 'test-only-bootstrap-password', pin: '4815' }),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function localAdminLogin() {
  return jsonResponse({ jwt: 'bootstrap-jwt' });
}

function mockBootstrapState(state: 'missing' | 'malformed' | 'unavailable') {
  mocks.fetch
    .mockResolvedValueOnce(localAdminLogin())
    .mockResolvedValueOnce(jsonResponse({ configured: false, state }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
}

describe('POST /api/auth/bootstrap-pin', () => {
  beforeEach(() => {
    mocks.cfEnv.mockImplementation((key: string) => {
      if (key === 'ENV') return 'staging';
      if (key === 'JWT_SIGNING_KEY') return 'test-signing-key';
      return undefined;
    });
    mocks.fetch.mockReset();
    mocks.verifyJwt.mockReset();
    mocks.verifyJwt.mockResolvedValue({ role: 'admin', sub: 0, emp: 'admin' });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('initializes a missing canonical Worker setting for a verified staging admin', async () => {
    mockBootstrapState('missing');
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.staging.bid.mbfdhub.com/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.staging.bid.mbfdhub.com/api/admin/settings/bid-pin',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer bootstrap-jwt' }),
      }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      3,
      'https://api.staging.bid.mbfdhub.com/api/admin/settings/bid-pin',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ authorization: 'Bearer bootstrap-jwt' }),
      }),
    );
  });

  it('permits a staging-local admin to recover a malformed canonical setting', async () => {
    mockBootstrapState('malformed');
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      'https://api.staging.bid.mbfdhub.com/api/admin/settings/bid-pin',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('rejects bootstrap when the canonical PIN is already configured', async () => {
    mocks.fetch
      .mockResolvedValueOnce(localAdminLogin())
      .mockResolvedValueOnce(jsonResponse({ configured: true, pin: '6123' }));
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'PIN_ALREADY_CONFIGURED' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).not.toHaveBeenCalledWith(
      'https://api.staging.bid.mbfdhub.com/api/admin/settings/bid-pin',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('does not overwrite an already configured canonical PIN', async () => {
    mocks.fetch
      .mockResolvedValueOnce(localAdminLogin())
      .mockResolvedValueOnce(jsonResponse({ configured: true, pin: '6123' }));
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(
      mocks.fetch.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      ),
    ).toBe(false);
  });

  it('fails closed without a write when a configured response has an invalid PIN shape', async () => {
    mocks.fetch
      .mockResolvedValueOnce(localAdminLogin())
      .mockResolvedValueOnce(jsonResponse({ configured: true, pin: 'not-a-pin' }));
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'bootstrap_unavailable' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed without a write when the canonical PIN state is unavailable', async () => {
    mockBootstrapState('unavailable');
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'bootstrap_unavailable' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed without a write when the canonical PIN read fails', async () => {
    mocks.fetch
      .mockResolvedValueOnce(localAdminLogin())
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'bootstrap_unavailable' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a foreign-origin request before reading credentials or writing', async () => {
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request({ Origin: 'https://evil.example' }));

    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('is unavailable outside staging', async () => {
    mocks.cfEnv.mockImplementation((key: string) => {
      if (key === 'ENV') return 'production';
      if (key === 'JWT_SIGNING_KEY') return 'test-signing-key';
      return undefined;
    });
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request({ Origin: 'https://bid.mbfdhub.com' }));

    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-local-admin JWT before writing', async () => {
    mocks.fetch.mockResolvedValueOnce(localAdminLogin());
    mocks.verifyJwt.mockResolvedValue({ role: 'admin', sub: 1, emp: 'portal-admin' });
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 401 for invalid staging-local admin credentials without reading or writing PIN state', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_credentials' }, 401));
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
