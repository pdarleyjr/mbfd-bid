import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cfEnv: vi.fn(),
  cookies: vi.fn(),
  signWebSocketTicket: vi.fn(),
  verifyJwt: vi.fn(),
  getWorkerBase: vi.fn(() => 'https://api.staging.bid.mbfdhub.com'),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/jwt', () => ({
  signWebSocketTicket: mocks.signWebSocketTicket,
  verifyJwt: mocks.verifyJwt,
}));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: mocks.getWorkerBase }));

const csrfToken = 'csrf_123e4567-e89b-12d3-a456-426614174000';

function request({
  origin = 'https://staging.bid.mbfdhub.com',
  fetchSite = 'same-origin',
  csrf = csrfToken,
  body = { session_id: 'session-1' },
}: {
  origin?: string | null;
  fetchSite?: string | null;
  csrf?: string | null;
  body?: unknown;
} = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (origin !== null) headers.set('Origin', origin);
  if (fetchSite !== null) headers.set('Sec-Fetch-Site', fetchSite);
  if (csrf !== null) headers.set('X-MBFD-CSRF', csrf);
  return new Request('https://staging.bid.mbfdhub.com/api/auth/ws-ticket', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/ws-ticket', () => {
  beforeEach(() => {
    mocks.cfEnv.mockImplementation((key: string) => {
      if (key === 'ENV') return 'staging';
      if (key === 'JWT_SIGNING_KEY') return 'test-signing-key';
      return undefined;
    });
    mocks.cookies.mockReset();
    mocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) => {
        if (name === 'mbfd_bid_jwt') return { value: 'session-jwt' };
        if (name === 'mbfd_bid_csrf') return { value: csrfToken };
        return undefined;
      }),
      set: vi.fn(),
    });
    mocks.verifyJwt.mockReset();
    mocks.verifyJwt.mockResolvedValue({
      sub: 7,
      hub_user_id: 7,
      member_id: 42,
      security_version: 3,
      role: 'member',
    });
    mocks.signWebSocketTicket.mockReset();
    mocks.signWebSocketTicket.mockResolvedValue('opaque-short-lived-ticket');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/api/auth/revalidate'))
          return new Response(JSON.stringify({ jwt: 'refreshed-jwt' }), { status: 200 });
        if (url.endsWith('/api/me'))
          return new Response(JSON.stringify({ memberId: 314 }), { status: 200 });
        return new Response(null, { status: 404 });
      }),
    );
  });

  it('verifies the HttpOnly session then returns a session-scoped opaque ticket', async () => {
    const { POST } = await import('../../app/api/auth/ws-ticket/route');

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ticket: 'opaque-short-lived-ticket' });
    expect(mocks.verifyJwt).toHaveBeenCalledWith('refreshed-jwt', 'test-signing-key');
    expect(mocks.signWebSocketTicket).toHaveBeenCalledWith(
      { sub: 7, member_id: 314, security_version: 3, role: 'member', session_id: 'session-1' },
      'test-signing-key',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed when the Worker cannot resolve the exact local member identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/api/auth/revalidate'))
          return new Response(JSON.stringify({ jwt: 'refreshed-jwt' }), { status: 200 });
        return new Response(JSON.stringify({ error: 'missing_member' }), { status: 404 });
      }),
    );
    const { POST } = await import('../../app/api/auth/ws-ticket/route');

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'local_identity_required' });
    expect(mocks.signWebSocketTicket).not.toHaveBeenCalled();
  });

  it('rejects a request without the matching CSRF nonce before reading the access JWT', async () => {
    const { POST } = await import('../../app/api/auth/ws-ticket/route');

    const response = await POST(request({ csrf: null }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'csrf_token_forbidden' });
    expect(mocks.verifyJwt).not.toHaveBeenCalled();
    expect(mocks.signWebSocketTicket).not.toHaveBeenCalled();
  });

  it('fails closed for malformed session IDs after authenticating the browser session', async () => {
    const { POST } = await import('../../app/api/auth/ws-ticket/route');

    const response = await POST(request({ body: { session_id: '' } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' });
    expect(mocks.signWebSocketTicket).not.toHaveBeenCalled();
  });
});
