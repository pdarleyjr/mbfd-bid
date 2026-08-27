import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cookieSet = vi.fn();
  return {
    cfEnv: vi.fn(),
    cookieSet,
    cookies: vi.fn(async () => ({ set: cookieSet })),
    verifyJwt: vi.fn(),
  };
});

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/jwt', () => ({ verifyJwt: mocks.verifyJwt }));

function request({
  origin = 'https://staging.bid.mbfdhub.com',
  fetchSite = 'same-origin',
  jwt = 'valid-jwt',
}: {
  origin?: string | null;
  fetchSite?: string | null;
  jwt?: string;
} = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (origin !== null) headers.set('Origin', origin);
  if (fetchSite !== null) headers.set('Sec-Fetch-Site', fetchSite);

  return new Request('https://staging.bid.mbfdhub.com/api/auth/session-finalize', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jwt }),
  });
}

describe('POST /api/auth/session-finalize', () => {
  beforeEach(() => {
    mocks.cfEnv.mockImplementation((key: string) =>
      key === 'ENV' ? 'staging' : 'test-signing-key',
    );
    mocks.cookieSet.mockReset();
    mocks.cookies.mockClear();
    mocks.verifyJwt.mockReset();
    mocks.verifyJwt.mockResolvedValue({ role: 'admin', sub: 0, emp: 'admin' });
  });

  it.each([
    ['same-origin Fetch Metadata', 'same-origin'],
    ['absent Fetch Metadata', null],
  ])(
    'installs a secure JWT cookie for a valid same-origin request with %s',
    async (_label, fetchSite) => {
      const { POST } = await import('../../app/api/auth/session-finalize/route');

      const response = await POST(request({ fetchSite }));

      expect(response.status).toBe(204);
      expect(mocks.verifyJwt).toHaveBeenCalledWith('valid-jwt', 'test-signing-key');
      expect(mocks.cookieSet).toHaveBeenCalledWith(
        'mbfd_bid_jwt',
        'valid-jwt',
        expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict' }),
      );
    },
  );

  it.each([
    ['foreign Origin', 'https://evil.example', 'cross-site'],
    ['missing Origin', null, 'same-origin'],
    ['cross-site Fetch Metadata', 'https://staging.bid.mbfdhub.com', 'cross-site'],
    ['same-site Fetch Metadata', 'https://staging.bid.mbfdhub.com', 'same-site'],
  ])(
    'rejects %s before JWT verification or a cookie mutation',
    async (_label, origin, fetchSite) => {
      const { POST } = await import('../../app/api/auth/session-finalize/route');

      const response = await POST(request({ origin, fetchSite }));

      expect(response.status).toBe(403);
      expect(mocks.verifyJwt).not.toHaveBeenCalled();
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid JWT from the legitimate origin without installing a cookie', async () => {
    mocks.verifyJwt.mockRejectedValue(new Error('invalid JWT'));
    const { POST } = await import('../../app/api/auth/session-finalize/route');

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_jwt' });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
