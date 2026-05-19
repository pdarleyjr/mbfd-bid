import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import adminAudit from './routes/admin/audit.js';
import adminBidControls from './routes/admin/bid-controls.js';
import adminBidSession from './routes/admin/bid-session.js';
import adminBid from './routes/admin/bid.js';
import adminCredentials from './routes/admin/credentials.js';
import adminEligibilityPreview from './routes/admin/eligibility-preview.js';
import adminForceADay from './routes/admin/force-a-day.js';
import adminMembers from './routes/admin/members.js';
import adminPlacements from './routes/admin/placements.js';
import adminPositions from './routes/admin/positions.js';
import adminRuleBooks from './routes/admin/rule-books.js';
import adminRules from './routes/admin/rules.js';
import adminAi from './routes/ai.js';
import auth from './routes/auth.js';
import bid from './routes/bid.js';
import health from './routes/health.js';
import ws from './routes/ws.js';
import type { WorkerEnv } from './types/env.js';

// Typed route tree — used for AppType inference by the Hono RPC client.
// Middleware (.use) is intentionally omitted here: it mutates the schema
// type in a way that shadows route entries, breaking hc<AppType>() inference.
const routes = new Hono<{ Bindings: WorkerEnv }>()
  .route('/api', health)
  .route('/api/auth', auth)
  .route('/api', bid)
  .route('/api/ws', ws)
  .route('/api/admin/members', adminMembers)
  .route('/api/admin/credentials', adminCredentials)
  .route('/api/admin/positions', adminPositions)
  .route('/api/admin/rules', adminRules)
  .route('/api/admin/rule-books', adminRuleBooks)
  .route('/api/admin/bid', adminBid)
  .route('/api/admin/bid-session', adminBidSession)
  .route('/api/admin/bid-session', adminBidControls)
  .route('/api/admin/bid-session', adminForceADay)
  .route('/api/admin/audit', adminAudit)
  .route('/api/admin/eligibility', adminEligibilityPreview)
  .route('/api/admin/placements', adminPlacements)
  .route('/api/admin/ai', adminAi);

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

export { BidSessionDO } from './durable/bid-session.js';

import { handleScheduled } from './scheduled.js';

// Hono app exposed as a named export so tests can call `app.request(...)`
// directly. Wrangler boots from the default export below which wraps both
// `fetch` and `scheduled` per the modules-format Worker contract.
export { app };

const handler = {
  fetch: app.fetch.bind(app),
  scheduled: async (
    _event: ScheduledEvent,
    env: WorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> => {
    await handleScheduled(env);
  },
};

export default handler;
