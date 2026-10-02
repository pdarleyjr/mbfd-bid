import { BID_SESSION_MAX_AGE_SEC } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/auth/operator-status/route';
import { CSRF_COOKIE_OPTS, JWT_COOKIE_OPTS, PIN_COOKIE_OPTS } from '../../lib/cookies';
import { signJwt, verifyJwt } from '../../lib/jwt';

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cfEnv: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }),
}));
vi.mock('@/lib/cf-env', () => ({ cfEnv: mocks.cfEnv }));
vi.mock('@/lib/worker-base', () => ({ getWorkerBase: () => 'https://worker.example' }));

const NOW = 1_800_000_000;
const KEY = 'a'.repeat(64);
const claims = {
  sub: 901,
  hub_user_id: 901,
  member_id: 42,
  security_version: 3,
  emp: 'synthetic-42',
  role: 'admin' as const,
  rank: 'LT' as const,
  first_name: 'Synthetic',
  last_name: 'Operator',
  fresh_auth_at: NOW - 299,
  authz_checked_at: NOW,
};
let originalToken: string;
let workerResponse: Response;
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
  mocks.cookieSet.mockReset();
  mocks.cookieGet.mockImplementation((name) =>
    name === 'mbfd_bid_jwt' ? { value: originalToken } : undefined,
  );
  mocks.cfEnv.mockReturnValue(KEY);
  originalToken = await signJwt(claims, KEY);
  workerResponse = Response.json({ jwt: await signJwt(claims, KEY) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => workerResponse.clone()),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function getStatus() {
  return GET();
}

describe('server operator status revalidation', () => {
  it('returns signed session expiry and verified identity without returning an access token', async () => {
    const response = await getStatus();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      operatorKey: '901:42:3',
      expiresAtSec: (await verifyJwt(originalToken, KEY)).exp,
      serverNowSec: NOW,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledWith('https://worker.example/api/auth/revalidate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${originalToken}` },
      cache: 'no-store',
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'mbfd_bid_jwt',
      expect.any(String),
      JWT_COOKIE_OPTS,
    );
    expect(mocks.cookieSet).toHaveBeenCalledTimes(1);
  });
  it('requires an existing valid admin token before contacting the Worker', async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    expect((await getStatus()).status).toBe(401);
    originalToken = await signJwt(claims, 'b'.repeat(64));
    mocks.cookieGet.mockImplementation(() => ({ value: originalToken }));
    expect((await getStatus()).status).toBe(401);
    originalToken = await signJwt({ ...claims, role: 'member' }, KEY);
    expect((await getStatus()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
  it('does not renew a signed but expired session', async () => {
    originalToken = await signJwt(claims, KEY, '-1s');
    expect((await getStatus()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
  it('extends existing valid PIN and CSRF cookies unchanged after same-identity renewal', async () => {
    const csrf = 'csrf_123e4567-e89b-12d3-a456-426614174000';
    mocks.cookieGet.mockImplementation((name) => ({
      value: name === 'mbfd_bid_jwt' ? originalToken : name === 'mbfd_pin' ? 'ok' : csrf,
    }));
    expect((await getStatus()).status).toBe(200);
    expect(mocks.cookieSet).toHaveBeenCalledWith('mbfd_pin', 'ok', PIN_COOKIE_OPTS);
    expect(mocks.cookieSet).toHaveBeenCalledWith('mbfd_bid_csrf', csrf, CSRF_COOKIE_OPTS);
    for (const options of [JWT_COOKIE_OPTS, PIN_COOKIE_OPTS, CSRF_COOKIE_OPTS]) {
      expect(options).toMatchObject({
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: BID_SESSION_MAX_AGE_SEC,
      });
    }
    expect(JWT_COOKIE_OPTS.httpOnly).toBe(true);
    expect(PIN_COOKIE_OPTS.httpOnly).toBe(true);
    expect(CSRF_COOKIE_OPTS.httpOnly).toBe(false);
  });
  it.each([401, 503])(
    'fails closed after Worker revocation or unavailability (%s)',
    async (httpStatus) => {
      workerResponse = Response.json({ error: 'invalid_identity' }, { status: httpStatus });
      const response = await getStatus();
      expect(response.status).toBe(httpStatus);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    },
  );
  it.each([
    { sub: 902, hub_user_id: 902 },
    { member_id: 43 },
    { security_version: 4 },
    { role: 'member' as const },
  ])('rejects a changed identity, security version or downgraded role %j', async (change) => {
    workerResponse = Response.json({ jwt: await signJwt({ ...claims, ...change }, KEY) });
    const response = await getStatus();
    expect(response.status).toBe(401);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
  it('rejects malformed or incorrectly signed refreshed credentials', async () => {
    workerResponse = Response.json({ jwt: await signJwt(claims, 'b'.repeat(64)) });
    expect((await getStatus()).status).toBe(401);
    workerResponse = Response.json({ jwt: null });
    expect((await getStatus()).status).toBe(401);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
