import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import healthRoutes from '../../src/routes/health';
import type { WorkerEnv } from '../../src/types/env';

describe('GET /health', () => {
  it('returns 200 with version info', async () => {
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/', healthRoutes);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; env: string; ts: number };
    expect(body.ok).toBe(true);
    expect(body.env).toBeDefined();
    expect(typeof body.ts).toBe('number');
  });
});
