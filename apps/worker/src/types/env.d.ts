import type { D1Database, DurableObjectNamespace, KVNamespace } from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENV: 'staging' | 'production';
  PORTAL_BASE_URL: string;
  JWT_SIGNING_KEY: string;
  PIN_HASH: string;
  PORTAL_BID_READER: string;
  LOCAL_ADMIN_PASSWORD_HASH?: string;
  // Plan 06 — AI integration
  CF_AI_GATEWAY_URL: string;
  ANTHROPIC_API_KEY: string;
  AI_BUDGET_CAP_CENTS: number;
  AI_FEATURE_FLAG_KEY: string;
  // Bindings
  DB: D1Database;
  KV: KVNamespace;
  BID_SESSION: DurableObjectNamespace;
  /** Separate namespace for AI cache / cost / fallback. Kept distinct
   * from the auth KV so eviction policy can differ. */
  AI_KV: KVNamespace;
}
