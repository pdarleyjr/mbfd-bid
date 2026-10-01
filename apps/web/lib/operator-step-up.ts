import type { JwtPayload } from '@mbfd/shared';

/** Display/recovery timing only. Worker requireStepUp remains the command authority. */
export const OPERATOR_STEP_UP_MAX_AGE_SEC = 300;
export const BEFORE_OPERATOR_COMMAND = 'mbfd-before-operator-command';
export const OPERATOR_STEP_UP_REQUIRED = 'mbfd-operator-step-up-required';
export const OPERATOR_AUTH_REFRESHED = 'mbfd-operator-auth-refreshed';

export type OperatorStepUpStatus = {
  operatorKey: string;
  freshAuthAtSec: number;
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
    typeof status.freshAuthAtSec !== 'number' ||
    !Number.isSafeInteger(status.freshAuthAtSec) ||
    typeof status.serverNowSec !== 'number' ||
    !Number.isSafeInteger(status.serverNowSec) ||
    status.freshAuthAtSec <= 0 ||
    status.serverNowSec <= 0
  )
    return null;
  return {
    operatorKey: status.operatorKey,
    freshAuthAtSec: status.freshAuthAtSec,
    serverNowSec: status.serverNowSec,
  };
}
export function operatorSignInRemaining(status: OperatorStepUpStatus, elapsedSec = 0): number {
  const age = status.serverNowSec + Math.max(0, elapsedSec) - status.freshAuthAtSec;
  return age < 0 ? 0 : Math.max(0, OPERATOR_STEP_UP_MAX_AGE_SEC - age);
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
    if (body && typeof body === 'object' && 'error' in body && body.error === 'step_up_required')
      window.dispatchEvent(new Event(OPERATOR_STEP_UP_REQUIRED));
  }
  return response;
}
