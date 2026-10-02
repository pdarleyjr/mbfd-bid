import type { JwtPayload } from '@mbfd/shared';

/** Display/recovery timing only. Worker Hub revalidation remains the command authority. */
export const BEFORE_OPERATOR_COMMAND = 'mbfd-before-operator-command';
export const OPERATOR_STEP_UP_REQUIRED = 'mbfd-operator-step-up-required';
export const OPERATOR_AUTH_REFRESHED = 'mbfd-operator-auth-refreshed';
export const OPERATOR_REAUTH_STARTED = 'mbfd-operator-reauth-started';

let authGeneration = 0;
/** Cache invalidation marker only; it never grants command authority. */
export function operatorAuthGeneration(): number {
  return authGeneration;
}
export function notifyOperatorAuthRefreshed(): void {
  authGeneration += 1;
  window.dispatchEvent(new Event(OPERATOR_AUTH_REFRESHED));
}

export type OperatorStepUpStatus = {
  operatorKey: string;
  expiresAtSec: number;
  serverNowSec: number;
};
export function operatorSessionKey(
  claims: Pick<JwtPayload, 'sub' | 'member_id' | 'security_version'>,
): string {
  return `${claims.sub}:${claims.member_id}:${claims.security_version}`;
}
export function parseOperatorStepUpStatus(value: unknown): OperatorStepUpStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = value as Record<string, unknown>;
  if (
    typeof status.operatorKey !== 'string' ||
    !/^\d+:\d+:\d+$/.test(status.operatorKey) ||
    typeof status.expiresAtSec !== 'number' ||
    !Number.isSafeInteger(status.expiresAtSec) ||
    typeof status.serverNowSec !== 'number' ||
    !Number.isSafeInteger(status.serverNowSec) ||
    status.expiresAtSec <= 0 ||
    status.serverNowSec <= 0
  )
    return null;
  return {
    operatorKey: status.operatorKey,
    expiresAtSec: status.expiresAtSec,
    serverNowSec: status.serverNowSec,
  };
}
export function operatorSignInRemaining(status: OperatorStepUpStatus, elapsedSec = 0): number {
  return Math.max(0, status.expiresAtSec - status.serverNowSec - Math.max(0, elapsedSec));
}
export function beforeOperatorCommand(): string | null {
  if (typeof window === 'undefined') return null;
  const event = new CustomEvent(BEFORE_OPERATOR_COMMAND, {
    cancelable: true,
    detail: { error: 'step_up_required' },
  });
  return window.dispatchEvent(event) ? null : event.detail.error;
}
export async function observeOperatorResponse(response: Response): Promise<Response> {
  if (typeof window !== 'undefined' && response.status === 401) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string' &&
      [
        'step_up_required',
        'missing_auth',
        'invalid_session',
        'invalid_identity',
        'invalid_token',
        'session_revalidation_required',
      ].includes(body.error)
    )
      window.dispatchEvent(new Event(OPERATOR_STEP_UP_REQUIRED));
  }
  return response;
}
