import { getRequestContext } from '@cloudflare/next-on-pages';

/**
 * Read a secret/env var on Cloudflare Pages.
 *
 * @cloudflare/next-on-pages does NOT populate `process.env` from secrets
 * configured via `wrangler pages secret put`. Server code must read them
 * via `getRequestContext().env`. For local dev / Node runtime we fall back
 * to `process.env`.
 */
export function cfEnv(key: string): string | undefined {
  try {
    const { env } = getRequestContext();
    const value = (env as unknown as Record<string, string | undefined>)[key];
    if (value !== undefined) return value;
  } catch {
    // getRequestContext throws outside an edge request (build, Node dev).
  }
  return process.env[key];
}
