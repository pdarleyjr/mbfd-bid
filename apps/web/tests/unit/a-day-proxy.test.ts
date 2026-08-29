import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cfEnv: vi.fn(),
  cookies: vi.fn(),
  fetch: vi.fn(),
  getWorkerBase: vi.fn(() => 'https://api.staging.bid.mbfdhub.com'),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: mocks.getWorkerBase }));

const csrfToken = 'csrf_123e4567-e89b-12d3-a456-426614174000';

function pickRequest({ csrf = csrfToken }: { csrf?: string | null } = {}): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: 'https://staging.bid.mbfdhub.com',
    'sec-fetch-site': 'same-origin',
  });
  if (csrf !== null) headers.set('x-mbfd-csrf', csrf);
  return new Request('https://staging.bid.mbfdhub.com/api/bid/a-day-pick', {
    method: 'POST',
    headers,
    body: JSON.stringify({ v: 1, bidSessionId: 'session-1', aDay: 'G1' }),
  });
}

describe('A-Day same-origin proxy', () => {
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
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('forwards a cookie-authenticated A-Day read server-side without a browser bearer token', async () => {
    const { GET } = await import('../../app/api/bid/a-day-state/route');

    const response = await GET(
      new Request('https://staging.bid.mbfdhub.com/api/bid/a-day-state?session=session-1'),
    );

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.staging.bid.mbfdhub.com/api/bid/a-day-state?session=session-1',
      expect.objectContaining({ method: 'GET' }),
    );
    const headers = mocks.fetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer session-jwt');
  });

  it('rejects an A-Day mutation without a matching nonce before forwarding to the Worker', async () => {
    const { POST } = await import('../../app/api/bid/a-day-pick/route');

    const response = await POST(pickRequest({ csrf: null }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'csrf_token_forbidden' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('forwards a valid A-Day mutation using the HttpOnly session only at the server boundary', async () => {
    const { POST } = await import('../../app/api/bid/a-day-pick/route');

    const response = await POST(pickRequest());

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.staging.bid.mbfdhub.com/api/bid/a-day-pick',
      expect.objectContaining({ method: 'POST' }),
    );
    const headers = mocks.fetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer session-jwt');
  });
});
