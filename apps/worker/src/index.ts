import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import auth from './routes/auth';
import health from './routes/health';
import type { WorkerEnv } from './types/env';

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!origin) return null;
      // Parse the origin properly; reject anything that fails URL parsing.
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        return null;
      }

      const isProd = c.env?.ENV === 'production';

      // Production / staging: HTTPS only, exact host or subdomain of bid.mbfdhub.com
      if (
        url.protocol === 'https:' &&
        (url.hostname === 'bid.mbfdhub.com' || url.hostname.endsWith('.bid.mbfdhub.com'))
      ) {
        return origin;
      }

      // Local dev only — never in production. Allow http://localhost on any port.
      if (!isProd && url.protocol === 'http:' && url.hostname === 'localhost') {
        return origin;
      }

      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.route('/api', health);
app.route('/api/auth', auth);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error('[worker error]', err);
  return c.json({ error: 'Internal Error' }, 500);
});

export default app;
