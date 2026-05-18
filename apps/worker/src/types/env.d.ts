import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENV: 'staging' | 'production';
  PORTAL_BASE_URL: string;
  // Secrets (set via wrangler secret put)
  JWT_SIGNING_KEY: string;
  PIN_HASH: string;
  PORTAL_BID_READER: string;
  // Bindings
  DB: D1Database;
  KV: KVNamespace;
}
