import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Read a secret/env var on a Cloudflare Worker.
 *
 * OpenNext exposes Worker bindings through `getCloudflareContext().env`.
 * For local Node-only execution we fall back to `process.env`.
 */
export function cfEnv(key: string): string | undefined {
  try {
    const { env } = getCloudflareContext();
    const value = (env as unknown as Record<string, string | undefined>)[key];
    if (value !== undefined) return value;
  } catch {
    // Context is unavailable outside a Worker request (for example, tests).
  }
  return process.env[key];
}
