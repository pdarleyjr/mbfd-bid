import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { isExpectedPublicWebOrigin } from './lib/public-web-origin.js';
import { redactRequestLog } from './lib/request-log.js';
import { applySecurityHeaders } from './middleware/security-headers.js';
import adminAiAssist from './routes/admin/ai-assist.js';
import adminAudit from './routes/admin/audit.js';
import adminBidAwardTransition from './routes/admin/bid-award-transition.js';
import adminBidConfiguration from './routes/admin/bid-configuration.js';
import adminBidControls from './routes/admin/bid-controls.js';
import adminBidSession from './routes/admin/bid-session.js';
import adminBid from './routes/admin/bid.js';
import adminCredentials from './routes/admin/credentials.js';
import adminCurrentRoster from './routes/admin/current-roster.js';
import adminEligibilityPreview from './routes/admin/eligibility-preview.js';
import adminExports from './routes/admin/exports.js';
import adminForceADay from './routes/admin/force-a-day.js';
import adminMembers from './routes/admin/members.js';
import adminPersonnel from './routes/admin/personnel.js';
import adminPlacements from './routes/admin/placements.js';
import adminPortal from './routes/admin/portal.js';
import adminPostBidTransition from './routes/admin/post-bid-transition.js';
import adminPositions from './routes/admin/positions.js';
import adminQualificationLifecycle from './routes/admin/qualification-lifecycle.js';
import adminReadiness from './routes/admin/readiness.js';
import adminRehearsal from './routes/admin/rehearsal.js';
import adminRuleBooks from './routes/admin/rule-books.js';
import adminRules from './routes/admin/rules.js';
import adminSettings from './routes/admin/settings.js';
import adminSpecialtyAdjudication from './routes/admin/specialty-adjudication.js';
import adminTelestaff from './routes/admin/telestaff.js';
import auth from './routes/auth.js';
import bid from './routes/bid.js';
import health from './routes/health.js';
import portalBridge from './routes/portal-bridge.js';
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
  .route('/api/admin/ai-assist', adminAiAssist)
  .route('/api/admin/members', adminMembers)
  .route('/api/admin/personnel', adminPersonnel)
  .route('/api/admin/qualification-lifecycle', adminQualificationLifecycle)
  .route('/api/admin/credentials', adminCredentials)
  .route('/api/admin/current-roster', adminCurrentRoster)
  .route('/api/admin/telestaff', adminTelestaff)
  .route('/api/admin/positions', adminPositions)
  .route('/api/admin/rules', adminRules)
  .route('/api/admin/rule-books', adminRuleBooks)
  .route('/api/admin/bid', adminBid)
  .route('/api/admin/bid-session', adminBidSession)
  .route('/api/admin/bid-session', adminSpecialtyAdjudication)
  .route('/api/admin/bid-configuration', adminBidConfiguration)
  .route('/api/admin/bid-session', adminBidControls)
  .route('/api/admin/bid-session', adminForceADay)
  .route('/api/admin/audit', adminAudit)
  .route('/api/admin/bid-award-transition', adminBidAwardTransition)
  .route('/api/admin/post-bid-transition', adminPostBidTransition)
  .route('/api/admin/exports', adminExports)
  .route('/api/admin', adminPortal)
  .route('/api/admin/eligibility', adminEligibilityPreview)
  .route('/api/admin/placements', adminPlacements)
  .route('/api/admin/rehearsal', adminRehearsal)
  .route('/api/admin/readiness', adminReadiness)
  .route('/api/admin/settings', adminSettings)
  .route('/api/portal', portalBridge);

export type AppType = typeof routes;

// Main application — middleware applied separately to avoid schema mutation.
const app = new Hono<{ Bindings: WorkerEnv }>();

app.use(
  '*',
  logger((message) => console.log(redactRequestLog(message))),
);
// Plan 09 Task 4 — every response (including 404/500) carries CSP, HSTS,
// and the rest of the security header set.
app.use('*', async (c, next) => {
  await next();
  applySecurityHeaders(c.res.headers);
});
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!origin) return null;
      // Deployed environments accept only their own exact public origin.
      // In particular, staging cannot become a credentialed CORS peer for
      // production, and vice versa.
      if (isExpectedPublicWebOrigin(c.env, origin)) {
        return origin;
      }
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.route('/', routes);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  console.error('[worker error]', err);
  return c.json({ error: 'internal_error' }, 500);
});

export { BidSessionDO } from './durable/bid-session.js';

import type { MessageBatch as CfMessageBatch } from '@cloudflare/workers-types';

import { handlePortalQueueBatch } from './portal-writeback/queue-handler.js';
import { handleCanonicalAuditArchive, handlePortalReconciliation } from './scheduled.js';

// Hono app exposed as a named export so tests can call `app.request(...)`
// directly. Wrangler boots from the default export below which wraps
// `fetch`, `scheduled`, AND `queue` per the modules-format Worker contract.
export { app };

const handler = {
  fetch: app.fetch.bind(app),
  scheduled: async (
    event: ScheduledEvent,
    env: WorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> => {
    // The retained 04:15 UTC cron repairs both portal write-backs and the
    // post-commit canonical audit archive outbox. Unknown/retired cron events
    // remain ignored.
    if (event.cron === '15 4 * * *') {
      const results = await Promise.allSettled([
        handlePortalReconciliation(env),
        handleCanonicalAuditArchive(env),
      ]);
      for (const [name, result] of [
        ['portal reconciliation', results[0]],
        ['canonical audit archive', results[1]],
      ] as const) {
        if (result.status === 'rejected') {
          console.error(`[scheduled] ${name} failed`, result.reason);
        }
      }
    }
  },
  /** Plan 08 Task 22 — Cloudflare Queue consumer for portal write-backs. */
  queue: async (batch: CfMessageBatch, env: WorkerEnv, _ctx: ExecutionContext): Promise<void> => {
    await handlePortalQueueBatch(batch, env);
  },
};

export default handler;
