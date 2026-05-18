import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import adminCredentials from './routes/admin/credentials.js';
import adminMembers from './routes/admin/members.js';
import adminPositions from './routes/admin/positions.js';
import adminRules from './routes/admin/rules.js';
import auth from './routes/auth.js';
import health from './routes/health.js';
import type { WorkerEnv } from './types/env.js';

// Typed route tree — used for AppType inference by the Hono RPC client.
// Middleware (.use) is intentionally omitted here: it mutates the schema
// type in a way that shadows route entries, breaking hc<AppType>() inference.
const routes = new Hono<{ Bindings: WorkerEnv }>()
  .route('/api', health)
  .route('/api/auth', auth)
  .route('/api/admin/members', adminMembers)
  .route('/api/admin/credentials', adminCredentials)
  .route('/api/admin/positions', adminPositions)
  .route('/api/admin/rules', adminRules);

export type AppType = typeof routes;

// Main application — middleware applied separately to avoid schema mutation.
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

app.route('/', routes);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error('[worker error]', err);
  return c.json({ error: 'Internal Error' }, 500);
});

export default app;
