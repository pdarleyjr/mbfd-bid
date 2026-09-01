import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import auth from '../../src/routes/auth';
import type { WorkerEnv } from '../../src/types/env';

const ORIG_FETCH = globalThis.fetch;

function env(environment: 'staging' | 'production' = 'staging'): WorkerEnv {
  return {
    ENV: environment,
    PORTAL_BASE_URL:
      environment === 'staging' ? 'https://staging.mbfdhub.com' : 'https://www.mbfdhub.com',
    JWT_SIGNING_KEY: 'A'.repeat(64),
    PORTAL_BID_READER: 'reader-token',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    BROWSER: {} as never,
  };
}

function app() {
  return new Hono<{ Bindings: WorkerEnv }>().route('/api/auth', auth);
}

function hubSuccess(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      issuer: 'https://staging.mbfdhub.com',
      audience: 'bid',
      member_id: 555,
      employee_id: '55555',
      first_name: 'Peter',
      last_name: 'Darley',
      rank: 'Lieutenant',
      role: 'member',
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('POST /api/auth/exchange', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it('exchanges an opaque Hub code server-to-server and issues a scoped Bid session token', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(hubSuccess());

    const response = await app().request(
      '/api/auth/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'A'.repeat(43),
          redirect_uri: 'https://staging.bid.mbfdhub.com/api/auth/callback',
        }),
      },
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: 'member',
      member: { member_id: 555, employee_id: '55555' },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://staging.mbfdhub.com/api/v2/bid/auth/exchange');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer reader-token');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      code: 'A'.repeat(43),
      client_id: 'bid',
      redirect_uri: 'https://staging.bid.mbfdhub.com/api/auth/callback',
    });
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('employee_id');
  });

  it('uses only the exact callback registered for the active Bid environment', async () => {
    const response = await app().request(
      '/api/auth/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'A'.repeat(43),
          redirect_uri: 'https://bid.mbfdhub.com/api/auth/callback',
        }),
      },
      env('staging'),
    );

    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for expired or replayed Hub codes', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_authorization_code' }), { status: 401 }),
    );

    const response = await app().request(
      '/api/auth/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'A'.repeat(43),
          redirect_uri: 'https://staging.bid.mbfdhub.com/api/auth/callback',
        }),
      },
      env(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_authorization_code' });
  });

  it('rejects a response that is not issuer and audience bound to Hub and Bid', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      hubSuccess({ issuer: 'https://evil.example', audience: 'another-app' }),
    );

    const response = await app().request(
      '/api/auth/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'A'.repeat(43),
          redirect_uri: 'https://staging.bid.mbfdhub.com/api/auth/callback',
        }),
      },
      env(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'portal_unavailable' });
  });

  it('applies the staging administrator override to canonical federation', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      hubSuccess({ role: 'member', employee_id: '20731' }),
    );

    const response = await app().request(
      '/api/auth/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'A'.repeat(43),
          redirect_uri: 'https://staging.bid.mbfdhub.com/api/auth/callback',
        }),
      },
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ role: 'admin' });
  });
});
