import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import auth from '../../src/routes/auth';
import type { WorkerEnv } from '../../src/types/env';

const ORIG_FETCH = globalThis.fetch;

function mkEnv(): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.test',
    JWT_SIGNING_KEY: 'A'.repeat(64),
    PIN_HASH: '$2b$12$placeholder',
    PORTAL_BID_READER: 'reader-tok',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
  };
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it('returns 200 + JWT on portal success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          member_id: 555,
          employee_id: '20731',
          first_name: 'Peter',
          last_name: 'Darley',
          rank: 'LT',
          role: 'member',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: '20731', password: 'pw-secret' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: string; role: string };
    expect(body.role).toBe('member');
    expect(body.jwt.split('.').length).toBe(3);
  });

  it('returns 401 on portal 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: 'x', password: 'wrongpw' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: '', password: 'x' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(400);
  });
});
