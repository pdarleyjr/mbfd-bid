import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cookieSet = vi.fn();
  return {
    cfEnv: vi.fn(),
    cookieSet,
    cookies: vi.fn(),
    verifyJwt: vi.fn(),
  };
});

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/jwt', () => ({ verifyJwt: mocks.verifyJwt }));

const csrfToken = 'csrf_123e4567-e89b-12d3-a456-426614174000';

function request({
  origin = 'https://staging.bid.mbfdhub.com',
  fetchSite = 'same-origin',
}: {
  origin?: string | null;
  fetchSite?: string | null;
} = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  if (fetchSite !== null) headers.set('Sec-Fetch-Site', fetchSite);
  return new Request('https://staging.bid.mbfdhub.com/api/auth/csrf', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/auth/csrf', () => {
  beforeEach(() => {
    mocks.cfEnv.mockImplementation((key: string) => {
      if (key === 'ENV') return 'staging';
      if (key === 'JWT_SIGNING_KEY') return 'test-signing-key';
      return undefined;
    });
    mocks.cookieSet.mockReset();
    mocks.cookies.mockReset();
    mocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'mbfd_bid_jwt' ? { value: 'session-jwt' } : undefined,
      ),
      set: mocks.cookieSet,
    });
    mocks.verifyJwt.mockReset();
    mocks.verifyJwt.mockResolvedValue({ role: 'member', sub: 7, session_id: 'unused' });
    vi.stubGlobal('crypto', { randomUUID: () => csrfToken.slice('csrf_'.length) });
  });

  it('verifies an authenticated same-origin session before issuing a secure client-readable nonce', async () => {
    const { POST } = await import('../../app/api/auth/csrf/route');

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token: csrfToken });
    expect(mocks.verifyJwt).toHaveBeenCalledWith('session-jwt', 'test-signing-key');
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'mbfd_bid_csrf',
      csrfToken,
      expect.objectContaining({ httpOnly: false, secure: true, sameSite: 'strict' }),
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['foreign Origin', 'https://evil.example', 'cross-site'],
    ['missing Origin', null, 'same-origin'],
    ['cross-site Fetch Metadata', 'https://staging.bid.mbfdhub.com', 'cross-site'],
  ])('rejects %s before reading or verifying a session', async (_label, origin, fetchSite) => {
    const { POST } = await import('../../app/api/auth/csrf/route');

    const response = await POST(request({ origin, fetchSite }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'csrf_bootstrap_origin_forbidden' });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.verifyJwt).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('fails closed when the session cookie cannot be verified', async () => {
    mocks.verifyJwt.mockRejectedValue(new Error('invalid session'));
    const { POST } = await import('../../app/api/auth/csrf/route');

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_session' });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
