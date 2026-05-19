import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  Queue,
  R2Bucket,
} from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENV: 'staging' | 'production';
  PORTAL_BASE_URL: string;
  JWT_SIGNING_KEY: string;
  PIN_HASH: string;
  PORTAL_BID_READER: string;
  /** Plan 08 — bearer token used by portal-client to POST /bid-assignment. */
  PORTAL_BID_WRITER?: string;
  LOCAL_ADMIN_PASSWORD_HASH?: string;
  // Plan 06 — AI integration
  CF_AI_GATEWAY_URL: string;
  ANTHROPIC_API_KEY: string;
  AI_BUDGET_CAP_CENTS: number;
  AI_FEATURE_FLAG_KEY: string;
  // Plan 08 — audit chain + exports
  AUDIT_SIGNING_PRIVKEY: string;
  AUDIT_SIGNING_PUBKEY: string;
  BROWSERLESS_TOKEN: string;
  // Bindings
  DB: D1Database;
  KV: KVNamespace;
  BID_SESSION: DurableObjectNamespace;
  /** Separate namespace for AI cache / cost / fallback. Kept distinct
   * from the auth KV so eviction policy can differ. */
  AI_KV: KVNamespace;
  /** Plan 08 — R2 bucket holding hash-chained, ed25519-signed JSONL audit chunks. */
  R2_AUDIT: R2Bucket;
  /** Plan 08 — R2 bucket for roster PDFs and audit CSV gzip exports. */
  R2_EXPORTS: R2Bucket;
  /** Plan 08 — Cloudflare Queue for portal write-back payloads. */
  PORTAL_QUEUE: Queue<unknown>;
}
