import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cookieSet = vi.fn();
  return {
    cookieSet,
    cookies: vi.fn(async () => ({ set: cookieSet })),
    getWorkerBase: vi.fn(() => 'https://api.staging.bid.mbfdhub.com'),
    fetch: vi.fn(),
  };
});

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: mocks.getWorkerBase }));

describe('POST /api/pin', () => {
  beforeEach(() => {
    mocks.cookieSet.mockReset();
    mocks.cookies.mockClear();
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets the PIN cookie only when the Worker accepts an explicitly configured PIN', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    const { POST } = await import('../../app/api/pin/route');

    const response = await POST(
      new Request('https://staging.bid.mbfdhub.com/api/pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.83' },
        body: JSON.stringify({ pin: '4815' }),
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
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.84' },
        body: JSON.stringify({ pin: '1357' }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'PIN_NOT_CONFIGURED' });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
