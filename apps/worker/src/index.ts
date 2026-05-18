import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import health from './routes/health';
import type { WorkerEnv } from './types/env';

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => {
      // Reflect-only for known hostnames; reject otherwise.
      if (!origin) return null;
      if (origin.endsWith('.bid.mbfdhub.com') || origin === 'https://bid.mbfdhub.com') {
        return origin;
      }
      if (origin.startsWith('http://localhost:')) return origin;
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.route('/api', health);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error('[worker error]', err);
  return c.json({ error: 'Internal Error' }, 500);
});

export default app;
