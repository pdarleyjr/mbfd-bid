import { cfEnv } from './cf-env';

/**
 * Returns the Worker API base URL for SSR fetches.
 *
 * Reads, in order:
 *   1. WORKER_URL Pages env (legacy name, used by most admin pages)
 *   2. WORKER_BASE_URL Pages env (newer name, used by bid + rehearsal pages)
 *   3. NEXT_PUBLIC_WORKER_BASE (baked at build time by CI)
 *   4. The staging hard-default (so a Pages deploy without env config still
 *      reaches the real worker instead of localhost).
 *
 * Production cutover (Plan 09b) replaces the hard-default with the prod URL.
 */
export function getWorkerBase(): string {
  return (
    cfEnv('WORKER_URL') ??
    cfEnv('WORKER_BASE_URL') ??
    cfEnv('NEXT_PUBLIC_WORKER_BASE') ??
    process.env.NEXT_PUBLIC_WORKER_BASE ??
    'https://api.staging.bid.mbfdhub.com'
  );
}
