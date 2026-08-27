import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cookieSet = vi.fn();
  return {
    cookieSet,
    cookies: vi.fn(async () => ({ set: cookieSet })),
    cfEnv: vi.fn(),
    getWorkerBase: vi.fn(() => 'https://api.staging.bid.mbfdhub.com'),
    fetch: vi.fn(),
  };
});

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: mocks.getWorkerBase }));

describe('POST /api/pin', () => {
  beforeEach(() => {
    mocks.cookieSet.mockReset();
    mocks.cookies.mockClear();
    mocks.fetch.mockReset();
    mocks.cfEnv.mockImplementation((key: string) => (key === 'ENV' ? 'staging' : undefined));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards the configured initial PIN through the Worker before setting the PIN cookie', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    const { POST } = await import('../../app/api/pin/route');

    const response = await POST(
      new Request('https://staging.bid.mbfdhub.com/api/pin', {
        method: 'POST',
        headers: {
          Origin: 'https://staging.bid.mbfdhub.com',
          'Sec-Fetch-Site': 'same-origin',
          'content-type': 'application/json',
          'cf-connecting-ip': '198.51.100.83',
        },
        body: JSON.stringify({ pin: '2300' }),
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'mbfd_pin',
      'ok',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict' }),
    );
  });

  it('propagates the Worker fail-closed PIN configuration error without setting a cookie', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'PIN_NOT_CONFIGURED' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { POST } = await import('../../app/api/pin/route');

    const response = await POST(
      new Request('https://staging.bid.mbfdhub.com/api/pin', {
        method: 'POST',
        headers: {
          Origin: 'https://staging.bid.mbfdhub.com',
          'Sec-Fetch-Site': 'same-origin',
          'content-type': 'application/json',
          'cf-connecting-ip': '198.51.100.84',
        },
        body: JSON.stringify({ pin: '1357' }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'PIN_NOT_CONFIGURED' });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('returns the Worker wrong-PIN response without setting a cookie', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_pin' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { POST } = await import('../../app/api/pin/route');

    const response = await POST(
      new Request('https://staging.bid.mbfdhub.com/api/pin', {
        method: 'POST',
        headers: {
          Origin: 'https://staging.bid.mbfdhub.com',
          'Sec-Fetch-Site': 'same-origin',
          'content-type': 'application/json',
          'cf-connecting-ip': '198.51.100.85',
        },
        body: JSON.stringify({ pin: '9999' }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_pin' });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign Origin', { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }],
    ['missing Origin', { 'Sec-Fetch-Site': 'same-origin' }],
    [
      'cross-site Fetch Metadata',
      { Origin: 'https://staging.bid.mbfdhub.com', 'Sec-Fetch-Site': 'cross-site' },
    ],
    [
      'same-site Fetch Metadata',
      { Origin: 'https://staging.bid.mbfdhub.com', 'Sec-Fetch-Site': 'same-site' },
    ],
  ])(
    'rejects %s before rate limiting, upstream verification, or a cookie mutation',
    async (_label, headers) => {
      const { POST } = await import('../../app/api/pin/route');

      const response = await POST(
        new Request('https://staging.bid.mbfdhub.com/api/pin', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ pin: '2300' }),
        }),
      );

      expect(response.status).toBe(403);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    },
  );
});
