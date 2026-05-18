import { Hono } from 'hono';
import type { WorkerEnv } from '../types/env';

const health = new Hono<{ Bindings: WorkerEnv }>();

health.get('/health', (c) => {
  return c.json({
    ok: true,
    env: c.env?.ENV ?? 'dev',
    ts: Date.now(),
  });
});

export default health;
