import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import auth from '../../src/routes/auth';
import type { WorkerEnv } from '../../src/types/env';

const ORIG_FETCH = globalThis.fetch;

function env(environment: 'staging' | 'production' = 'staging'): WorkerEnv {
  return {
    ENV: environment,
    PORTAL_BASE_URL:
      environment === 'staging' ? 'https://staging.mbfdhub.com' : 'https://www.mbfdhub.com',
    JWT_SIGNING_KEY: 'A'.repeat(64),
    PORTAL_BID_FEDERATION_TOKEN: 'federation-token',
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
      hub_user_id: 901,
      security_version: 3,
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
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer federation-token');
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

  it('does not infer admin from employee ID when Hub reports member', async () => {
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
    await expect(response.json()).resolves.toMatchObject({ role: 'member' });
  });
});

describe('POST /api/auth/revalidate', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  async function sessionToken() {
    return signJwt(
      {
        sub: 901,
        hub_user_id: 901,
        member_id: 555,
        emp: '55555',
        role: 'admin',
        security_version: 3,
        rank: 'LT',
        first_name: 'Peter',
        last_name: 'Darley',
        fresh_auth_at: 1_700_000_000,
        authz_checked_at: 1_700_000_000,
      },
      'A'.repeat(64),
    );
  }

  it('uses the federation credential and adopts Hub role downgrade without changing identities', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      hubSuccess({ role: 'member', rank: 'Lieutenant' }),
    );
    const response = await app().request(
      '/api/auth/revalidate',
      { method: 'POST', headers: { Authorization: `Bearer ${await sessionToken()}` } },
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ role: 'member' });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://staging.mbfdhub.com/api/v2/bid/auth/revalidate');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer federation-token');
    expect(JSON.parse(String(init.body))).toEqual({
      hub_user_id: 901,
      security_version: 3,
      member_id: 555,
    });
  });

  it('fails closed when Hub rejects a disabled, unlinked, or security-version-mismatched identity', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    const response = await app().request(
      '/api/auth/revalidate',
      { method: 'POST', headers: { Authorization: `Bearer ${await sessionToken()}` } },
      env(),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_identity' });
  });

  it('does not turn Hub unavailability into a local authorization decision', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    const response = await app().request(
      '/api/auth/revalidate',
      { method: 'POST', headers: { Authorization: `Bearer ${await sessionToken()}` } },
      env(),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'authorization_unavailable' });
  });
});
