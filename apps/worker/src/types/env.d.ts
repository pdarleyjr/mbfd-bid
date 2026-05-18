import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENV: 'staging' | 'production';
  PORTAL_BASE_URL: string;
  // Secrets (set via wrangler secret put)
  JWT_SIGNING_KEY: string;
  PIN_HASH: string;
  PORTAL_BID_READER: string;
  // Comma-separated employee IDs promoted to role=admin at login time.
  // Rehearsal scaffolding for Plan 02; Plan 05 (admin console) supersedes it.
  ADMIN_EMPLOYEE_IDS?: string;
  // Bindings
  DB: D1Database;
  KV: KVNamespace;
}
