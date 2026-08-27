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
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jwt: 'bootstrap-jwt' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('initializes only the canonical Worker setting for a verified staging admin', async () => {
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
        method: 'PUT',
        headers: expect.objectContaining({ authorization: 'Bearer bootstrap-jwt' }),
      }),
    );
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
    mocks.verifyJwt.mockResolvedValue({ role: 'admin', sub: 1, emp: 'portal-admin' });
    const { POST } = await import('../../app/api/auth/bootstrap-pin/route');

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
