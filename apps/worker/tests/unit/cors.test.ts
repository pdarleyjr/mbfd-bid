import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// Re-import the production app to test its CORS behavior end-to-end via OPTIONS preflight.
// We don't reach into internals; we just verify the response headers reflect the right origins.
import { app } from '../../src/index';
import type { WorkerEnv } from '../../src/types/env';

function mkEnv(env: 'staging' | 'production'): WorkerEnv {
  return {
    ENV: env,
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'x'.repeat(64),
    PIN_HASH: '$2b$12$placeholder',
    PORTAL_BID_READER: 'tok',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    BROWSER: {} as never,
  };
}

async function preflight(origin: string, env: 'staging' | 'production'): Promise<Response> {
  return app.request(
    '/api/health',
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type',
      },
    },
    mkEnv(env),
  );
}

describe('CORS origin predicate', () => {
  it('reflects https://bid.mbfdhub.com (apex)', async () => {
    const res = await preflight('https://bid.mbfdhub.com', 'production');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://bid.mbfdhub.com');
  });

  it('reflects https://staging.bid.mbfdhub.com (subdomain)', async () => {
    const res = await preflight('https://staging.bid.mbfdhub.com', 'staging');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://staging.bid.mbfdhub.com');
  });

  it('rejects the production web origin in staging', async () => {
    const res = await preflight('https://bid.mbfdhub.com', 'staging');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects the staging web origin in production', async () => {
    const res = await preflight('https://staging.bid.mbfdhub.com', 'production');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects http://bid.mbfdhub.com (no TLS)', async () => {
    const res = await preflight('http://bid.mbfdhub.com', 'production');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects https://bid.mbfdhub.com.evil.com (origin smuggling via suffix)', async () => {
    const res = await preflight('https://bid.mbfdhub.com.evil.com', 'production');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects https://evil.com (unrelated)', async () => {
    const res = await preflight('https://evil.com', 'production');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects http://localhost:3000.evil.com (subdomain smuggling)', async () => {
    const res = await preflight('http://localhost:3000.evil.com', 'staging');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects http://localhost:3000 in staging', async () => {
    const res = await preflight('http://localhost:3000', 'staging');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('REJECTS http://localhost:3000 in production', async () => {
    const res = await preflight('http://localhost:3000', 'production');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects malformed origin string', async () => {
    const res = await preflight('not-a-url', 'production');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects a non-standard port on an otherwise valid staging host', async () => {
    const res = await preflight('https://staging.bid.mbfdhub.com:8443', 'staging');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects requests with an unrecognized environment binding', async () => {
    const res = await app.request(
      '/api/health',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://staging.bid.mbfdhub.com',
          'Access-Control-Request-Method': 'GET',
        },
      },
      { ...mkEnv('staging'), ENV: undefined } as unknown as WorkerEnv,
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
