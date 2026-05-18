import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENV: 'staging' | 'production';
  PORTAL_BASE_URL: string;
  // Secrets (set via wrangler secret put)
  JWT_SIGNING_KEY: string;
  PIN_HASH: string;
  PORTAL_BID_READER: string;
  // bcrypt hash of the shared admin account password. The username is
  // hard-wired to "admin" in the login route; the hash is the only secret.
  // Rehearsal scaffolding for Plan 02; Plan 05 (admin console) supersedes it.
  LOCAL_ADMIN_PASSWORD_HASH?: string;
  // Bindings
  DB: D1Database;
  KV: KVNamespace;
}
