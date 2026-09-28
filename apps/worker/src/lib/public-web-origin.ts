import type { WorkerEnv } from '../types/env.js';

/**
 * The one browser origin that may use an environment's credentialed HTTP or
 * WebSocket API. Unknown or absent environment bindings deliberately grant no
 * origin access.
 */
export function publicWebOrigin(
  env:
    | (Pick<WorkerEnv, 'ENV'> & Partial<Pick<WorkerEnv, 'PORTAL_BASE_URL' | 'WEB_BASE_URL'>>)
    | undefined,
): string | null {
  if (
    env?.ENV === 'staging' &&
    env.PORTAL_BASE_URL === 'https://test.invalid' &&
    env.WEB_BASE_URL === 'http://127.0.0.1:3000'
  )
    return env.WEB_BASE_URL;
  if (env?.ENV === 'production') return 'https://bid.mbfdhub.com';
  if (env?.ENV === 'staging') return 'https://staging.bid.mbfdhub.com';
  return null;
}

export function isExpectedPublicWebOrigin(
  env: Pick<WorkerEnv, 'ENV'> | undefined,
  origin: string | undefined,
): boolean {
  const expectedOrigin = publicWebOrigin(env);
  return expectedOrigin !== null && origin === expectedOrigin;
}
