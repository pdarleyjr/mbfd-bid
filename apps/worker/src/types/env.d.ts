import type { D1Database, DurableObjectNamespace, KVNamespace } from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENV: 'staging' | 'production';
  PORTAL_BASE_URL: string;
  JWT_SIGNING_KEY: string;
  PIN_HASH: string;
  PORTAL_BID_READER: string;
  LOCAL_ADMIN_PASSWORD_HASH?: string;
  DB: D1Database;
  KV: KVNamespace;
  BID_SESSION: DurableObjectNamespace;
}
