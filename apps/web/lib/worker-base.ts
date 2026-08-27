import { cfEnv } from './cf-env';

/**
 * Returns the Worker API base URL for SSR fetches.
 *
 * Reads, in order:
 *   1. WORKER_URL Worker env (legacy name, used by most admin pages)
 *   2. WORKER_BASE_URL Worker env (newer name, used by bid + rehearsal pages)
 *   3. NEXT_PUBLIC_WORKER_BASE (baked at build time by CI)
 *
 * There is deliberately no default endpoint. An isolated deployment must not
 * silently issue requests to the shared staging Worker when its binding is
 * missing.
 */
export function getWorkerBase(): string {
  const workerBase =
    cfEnv('WORKER_URL') ??
    cfEnv('WORKER_BASE_URL') ??
    cfEnv('NEXT_PUBLIC_WORKER_BASE') ??
    process.env.NEXT_PUBLIC_WORKER_BASE;

  if (!workerBase) throw new Error('worker_base_missing');
  return workerBase;
}
