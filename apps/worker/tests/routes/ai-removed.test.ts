import { describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';

const env = {
  ENV: 'staging',
  PORTAL_BASE_URL: 'https://portal.example',
  JWT_SIGNING_KEY: 'retired-ai-route-test-key'.repeat(3),
  DB: {
    prepare: () => ({ bind: () => ({ first: async () => null }) }),
  },
} as unknown as WorkerEnv;

describe('retired AI endpoints', () => {
  it.each([
    ['GET', '/api/admin/ai/advise-current?session_id=retired'],
    ['GET', '/api/admin/ai/cost?session_id=retired'],
    ['GET', '/api/admin/ai/forecast?session_id=retired'],
    ['POST', '/api/admin/ai/advise-deep'],
    ['GET', '/api/ai/advise-me?session_id=retired'],
    ['GET', '/api/admin/ai-assist/status'],
    ['POST', '/api/admin/ai-assist/explain'],
  ])('returns 404 for %s %s', async (method, path) => {
    const jwt = await signJwt(
      {
        sub: 0,
        emp: 'admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Retired',
        last_name: 'Feature',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      env.JWT_SIGNING_KEY,
    );
    const res = await app.request(
      path,
      { method, headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });
});
