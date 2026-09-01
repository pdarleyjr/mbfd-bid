import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cookieDelete = vi.fn();
  const cookieGet = vi.fn();
  const cookieSet = vi.fn();
  return {
    cfEnv: vi.fn(),
    cookieDelete,
    cookieGet,
    cookieSet,
    cookies: vi.fn(async () => ({
      delete: cookieDelete,
      get: cookieGet,
      set: cookieSet,
    })),
    getWorkerBase: vi.fn(() => 'https://api.staging.bid.mbfdhub.com'),
    verifyJwt: vi.fn(),
  };
});

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: mocks.getWorkerBase }));
vi.mock('@/lib/jwt', () => ({ verifyJwt: mocks.verifyJwt }));

describe('canonical Bid authentication routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.cookieDelete.mockReset();
    mocks.cookieGet.mockReset();
    mocks.cookieSet.mockReset();
    mocks.cookies.mockClear();
    mocks.getWorkerBase.mockReturnValue('https://api.staging.bid.mbfdhub.com');
    mocks.cfEnv.mockImplementation((key: string) => {
      if (key === 'ENV') return 'staging';
      if (key === 'JWT_SIGNING_KEY') return 'A'.repeat(64);
      return undefined;
    });
    mocks.verifyJwt.mockResolvedValue({ sub: 555, emp: '20731', role: 'admin' });
  });

  it('starts login with an exact registered callback and an HTTP-only expiring state cookie', async () => {
    const { GET } = await import('../../app/api/auth/start/route');

    const response = await GET();

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.origin + location.pathname).toBe('https://www.mbfdhub.com/auth/bid/authorize');
    expect(location.searchParams.get('client_id')).toBe('bid');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://staging.bid.mbfdhub.com/api/auth/callback',
    );
    const state = location.searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'mbfd_bid_auth_state',
      expect.stringContaining(`.${state}`),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 300 }),
    );
  });

  it('keeps the production callback distinct from staging', async () => {
    mocks.cfEnv.mockImplementation((key: string) =>
      key === 'ENV' ? 'production' : 'A'.repeat(64),
    );
    const { GET } = await import('../../app/api/auth/start/route');

    const response = await GET();
    const location = new URL(response.headers.get('Location') ?? '');

    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://bid.mbfdhub.com/api/auth/callback',
    );
    expect(location.searchParams.get('redirect_uri')).not.toContain('staging');
  });

  it('validates state, exchanges only the opaque code, and installs the scoped Bid JWT', async () => {
    const now = Date.now();
    const state = 'A'.repeat(43);
    mocks.cookieGet.mockImplementation((name: string) =>
      name === 'mbfd_bid_auth_state' ? { value: `${now}.${state}` } : undefined,
    );
    vi.spyOn(Date, 'now').mockReturnValue(now + 1_000);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ jwt: 'bid-jwt', role: 'admin' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const { GET } = await import('../../app/api/auth/callback/route');
    const response = await GET(
      new Request(
        `https://staging.bid.mbfdhub.com/api/auth/callback?code=${'B'.repeat(43)}&state=${state}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe('https://staging.bid.mbfdhub.com/admin');
    expect(mocks.cookieDelete).toHaveBeenCalledWith('mbfd_bid_auth_state');
    expect(mocks.verifyJwt).toHaveBeenCalledWith('bid-jwt', 'A'.repeat(64));
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'mbfd_bid_jwt',
      'bid-jwt',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      code: 'B'.repeat(43),
      redirect_uri: 'https://staging.bid.mbfdhub.com/api/auth/callback',
    });
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('employee_id');
  });

  it.each([
    ['missing state cookie', undefined, 'A'.repeat(43)],
    ['changed state', { value: `${Date.now()}.${'A'.repeat(43)}` }, 'B'.repeat(43)],
    ['expired state', { value: `${Date.now() - 301_000}.${'A'.repeat(43)}` }, 'A'.repeat(43)],
  ])('rejects %s before code exchange', async (_label, cookie, state) => {
    mocks.cookieGet.mockReturnValue(cookie);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../../app/api/auth/callback/route');
    const response = await GET(
      new Request(
        `https://staging.bid.mbfdhub.com/api/auth/callback?code=${'B'.repeat(43)}&state=${state}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('handles Hub denial without creating a Bid session', async () => {
    const now = Date.now();
    const state = 'A'.repeat(43);
    mocks.cookieGet.mockReturnValue({ value: `${now}.${state}` });
    vi.spyOn(Date, 'now').mockReturnValue(now + 1_000);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../../app/api/auth/callback/route');
    const response = await GET(
      new Request(
        `https://staging.bid.mbfdhub.com/api/auth/callback?error=access_denied&state=${state}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(
      'https://staging.bid.mbfdhub.com/login?error=access_denied',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
