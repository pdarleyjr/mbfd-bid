import type {
  D1Database,
  DurableObjectNamespace,
  Fetcher,
  KVNamespace,
  Queue,
  R2Bucket,
} from '@cloudflare/workers-types';

export interface WorkerEnv {
  ENV: 'staging' | 'production';
  PORTAL_BASE_URL: string;
  /** Literal "true" is required before any Worker path may publish a bid. */
  PORTAL_WRITEBACK_ENABLED?: 'true' | 'false';
  /** Deliberately separate from PORTAL_BASE_URL so read-only portal auth does
   * not imply an outbound publication destination. */
  PORTAL_WRITEBACK_BASE_URL?: string;
  JWT_SIGNING_KEY: string;
  /** Dedicated, rotation-stable HMAC key for persisted TeleStaff source references.
   *  It must never fall back to the JWT signing key. */
  TELESTAFF_HMAC_KEY?: string;
  PORTAL_BID_READER: string;
  /** Plan 08 — bearer token used by portal-client to POST /bid-assignment. */
  PORTAL_BID_WRITER?: string;
  LOCAL_ADMIN_PASSWORD_HASH?: string;
  // Plan 08 — audit chain + exports
  AUDIT_SIGNING_PRIVKEY: string;
  AUDIT_SIGNING_PUBKEY: string;
  /** @deprecated — kept for backwards compat. Replaced by Cloudflare Browser
   *  Rendering (`env.BROWSER`) for roster PDF rendering. Safe to remove once
   *  staging + production have been redeployed against the new binding. */
  BROWSERLESS_TOKEN?: string;
  /** Plan 08 — HMAC secret for print-token-authorized roster render URLs;
   *  falls back to JWT_SIGNING_KEY in dev. Still required: the headless
   *  browser fetches the web RSC page over the public internet, so the
   *  token is what authorizes the unauthenticated render endpoint. */
  PRINT_TOKEN_SECRET?: string;
  /** Plan 08 — public base URL of the web app (Browser Rendering target). */
  WEB_BASE_URL?: string;
  /** Plan 08 — R2 S3-compatible credentials for signed download URLs. */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  /** Plan 08 — R2 bucket name as configured in wrangler.toml. */
  R2_EXPORTS_BUCKET_NAME?: string;
  // Bindings
  DB: D1Database;
  KV: KVNamespace;
  BID_SESSION: DurableObjectNamespace;
  /** Plan 08 — R2 bucket holding hash-chained, ed25519-signed JSONL audit chunks. */
  R2_AUDIT: R2Bucket;
  /** Plan 08 — R2 bucket for roster PDFs and audit CSV gzip exports. */
  R2_EXPORTS: R2Bucket;
  /** Plan 08 — Cloudflare Queue for portal write-back payloads. */
  PORTAL_QUEUE: Queue<unknown>;
  /**
   * Cloudflare Browser Rendering binding (2026-05 swap). Headless Chromium
   * is launched via `@cloudflare/puppeteer`'s `puppeteer.launch(env.BROWSER)`.
   * Replaces the Browserless v2 HTTP API; included with the Workers Paid
   * plan (no external token required). Wrangler binding name: `BROWSER`.
   */
  BROWSER: Fetcher;
}
