import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cookieSet = vi.fn();
  return {
    cookieSet,
    cookies: vi.fn(async () => ({ set: cookieSet })),
    cfEnv: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
}));

vi.mock('@/lib/cf-env', () => ({
  cfEnv: mocks.cfEnv,
}));

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    mocks.cookieSet.mockReset();
    mocks.cookies.mockClear();
    mocks.cfEnv.mockImplementation((key: string) => (key === 'ENV' ? 'staging' : undefined));
  });

  it('expires both the JWT and PIN cookies', async () => {
    const { POST } = await import('../../app/api/auth/logout/route');

    const response = await POST(
      new Request('https://staging.bid.mbfdhub.com/api/auth/logout', {
        method: 'POST',
        headers: {
          Origin: 'https://staging.bid.mbfdhub.com',
          'Sec-Fetch-Site': 'same-origin',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
    expect(mocks.cookieSet).toHaveBeenNthCalledWith(1, 'mbfd_bid_jwt', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
    expect(mocks.cookieSet).toHaveBeenNthCalledWith(2, 'mbfd_pin', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
  });

  it.each([
    ['foreign Origin', { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }],
    ['null Origin', { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }],
    ['malformed Origin', { Origin: 'not a URL', 'Sec-Fetch-Site': 'cross-site' }],
    ['missing Origin', { 'Sec-Fetch-Site': 'same-origin' }],
    [
      'cross-site Fetch Metadata',
      { Origin: 'https://staging.bid.mbfdhub.com', 'Sec-Fetch-Site': 'cross-site' },
    ],
    [
      'same-site Fetch Metadata',
      { Origin: 'https://staging.bid.mbfdhub.com', 'Sec-Fetch-Site': 'same-site' },
    ],
  ])('rejects %s before any logout cookie mutation', async (_label, headers) => {
    const { POST } = await import('../../app/api/auth/logout/route');

    const response = await POST(
      new Request('https://staging.bid.mbfdhub.com/api/auth/logout', {
        method: 'POST',
        headers,
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('fails closed when the deployed environment is unknown', async () => {
    mocks.cfEnv.mockReturnValue(undefined);
    const { POST } = await import('../../app/api/auth/logout/route');

    const response = await POST(
      new Request('https://staging.bid.mbfdhub.com/api/auth/logout', {
        method: 'POST',
        headers: {
          Origin: 'https://staging.bid.mbfdhub.com',
          'Sec-Fetch-Site': 'same-origin',
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
});
