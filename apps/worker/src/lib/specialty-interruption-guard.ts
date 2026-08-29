import type { WorkerEnv } from '../types/env.js';
import { isValidSpecialtyAdjudicationState } from './specialty-adjudication.js';

export const NORMAL_MUTATION_LEASE_ACQUIRE_PATH = 'https://do/admin/normal-mutation-lease/acquire';
export const NORMAL_MUTATION_LEASE_RELEASE_PATH = 'https://do/admin/normal-mutation-lease/release';

export type NormalBidMutationGuardError =
  | 'specialty_adjudication_active'
  | 'specialty_adjudication_state_unavailable';

export type NormalBidMutationLeaseError =
  | NormalBidMutationGuardError
  | 'normal_mutation_lease_active'
  | 'normal_mutation_lease_state_unknown'
  | 'normal_mutation_lease_unavailable'
  | 'normal_mutation_lease_release_unavailable';

type NormalBidMutationGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: NormalBidMutationGuardError };

export type NormalBidMutationLeaseAcquireResult =
  | { readonly ok: true; readonly lease: NormalBidMutationLease }
  | { readonly ok: false; readonly error: NormalBidMutationLeaseError };

export type NormalBidMutationLeaseReleaseResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | 'normal_mutation_lease_state_unknown'
        | 'normal_mutation_lease_release_unavailable';
    };

export type NormalBidMutationLeaseRunResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: NormalBidMutationLeaseError };

export interface NormalBidMutationLease {
  /**
   * Releases the exact lease acquired by this request. The caller must invoke
   * this from a `finally` path after its D1 work; unknown release outcomes are
   * deliberately reported rather than being treated as success.
   */
  release(): Promise<NormalBidMutationLeaseReleaseResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}

function isKnownAcquireError(value: unknown): value is NormalBidMutationLeaseError {
  return (
    value === 'specialty_adjudication_active' ||
    value === 'specialty_adjudication_state_unavailable' ||
    value === 'normal_mutation_lease_active' ||
    value === 'normal_mutation_lease_state_unknown' ||
    value === 'normal_mutation_lease_unavailable'
  );
}

async function responseJson(response: { json: () => Promise<unknown> }): Promise<unknown | null> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function leaseStub(
  env: Pick<WorkerEnv, 'BID_SESSION'>,
  bidSessionId: string,
): ReturnType<WorkerEnv['BID_SESSION']['get']> {
  const doId = env.BID_SESSION.idFromName(bidSessionId);
  return env.BID_SESSION.get(doId);
}

/**
 * Read-only specialty status validation retained for callers that only need a
 * display/preflight result. It is intentionally not sufficient for a D1
 * writer: use `runWithNormalBidMutationLease` to hold the durable permit over
 * the actual write.
 */
export async function guardNormalBidMutation(
  env: Pick<WorkerEnv, 'BID_SESSION'>,
  bidSessionId: string,
): Promise<NormalBidMutationGuardResult> {
  try {
    const response = await leaseStub(env, bidSessionId).fetch(
      'https://do/admin/specialty-adjudication',
    );
    if (!response.ok) {
      return { ok: false, error: 'specialty_adjudication_state_unavailable' };
    }

    const payload: unknown = await responseJson(response);
    if (
      !isRecord(payload) ||
      payload.mode !== 'synthetic_test_only' ||
      payload.does_not_commit_bid !== true ||
      payload.database_audit_log !== 'not_written' ||
      !Array.isArray(payload.audit_receipts) ||
      !isValidSpecialtyAdjudicationState(payload.state)
    ) {
      return { ok: false, error: 'specialty_adjudication_state_unavailable' };
    }
    if (payload.state.active !== null) {
      return { ok: false, error: 'specialty_adjudication_active' };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'specialty_adjudication_state_unavailable' };
  }
}

async function releaseNormalBidMutationLease(
  env: Pick<WorkerEnv, 'BID_SESSION'>,
  bidSessionId: string,
  leaseId: string,
): Promise<NormalBidMutationLeaseReleaseResult> {
  try {
    const response = await leaseStub(env, bidSessionId).fetch(NORMAL_MUTATION_LEASE_RELEASE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lease_id: leaseId }),
    });
    const payload = await responseJson(response);
    if (response.ok && isRecord(payload) && payload.ok === true) {
      return { ok: true };
    }
    if (isRecord(payload) && payload.error === 'normal_mutation_lease_state_unknown') {
      return { ok: false, error: 'normal_mutation_lease_state_unknown' };
    }
    return { ok: false, error: 'normal_mutation_lease_release_unavailable' };
  } catch {
    return { ok: false, error: 'normal_mutation_lease_release_unavailable' };
  }
}

/**
 * Obtains a session-scoped permit from the same DO that owns synthetic
 * specialty interruptions. A missing, malformed, or unavailable response is
 * a hard stop: callers must never infer an inactive specialty state from a
 * failed lease acquisition.
 */
export async function acquireNormalBidMutationLease(
  env: Pick<WorkerEnv, 'BID_SESSION'>,
  bidSessionId: string,
): Promise<NormalBidMutationLeaseAcquireResult> {
  try {
    const response = await leaseStub(env, bidSessionId).fetch(NORMAL_MUTATION_LEASE_ACQUIRE_PATH, {
      method: 'POST',
    });
    const payload = await responseJson(response);
    if (
      response.ok &&
      isRecord(payload) &&
      payload.ok === true &&
      isNonEmptyString(payload.lease_id)
    ) {
      const leaseId = payload.lease_id;
      return {
        ok: true,
        lease: {
          release: () => releaseNormalBidMutationLease(env, bidSessionId, leaseId),
        },
      };
    }
    if (isRecord(payload) && isKnownAcquireError(payload.error)) {
      return { ok: false, error: payload.error };
    }
    return { ok: false, error: 'normal_mutation_lease_unavailable' };
  } catch {
    return { ok: false, error: 'normal_mutation_lease_unavailable' };
  }
}

/**
 * Runs one direct D1 mutation under a DO-scoped lease. The release is in the
 * `finally` path, so every successful acquisition is paired with a release
 * attempt even when the D1 operation throws. A release with an unknown result
 * overrides a nominal writer result and remains fail-closed.
 */
export async function runWithNormalBidMutationLease<T>(
  env: Pick<WorkerEnv, 'BID_SESSION'>,
  bidSessionId: string,
  writer: () => Promise<T>,
): Promise<NormalBidMutationLeaseRunResult<T>> {
  const acquired = await acquireNormalBidMutationLease(env, bidSessionId);
  if (!acquired.ok) return acquired;

  let writerResult: T | undefined;
  let writerError: unknown;
  let writerThrew = false;
  let released: NormalBidMutationLeaseReleaseResult = {
    ok: false,
    error: 'normal_mutation_lease_release_unavailable',
  };
  try {
    writerResult = await writer();
  } catch (error) {
    writerThrew = true;
    writerError = error;
  } finally {
    released = await acquired.lease.release();
  }

  if (!released.ok) return released;
  if (writerThrew) throw writerError;
  return { ok: true, value: writerResult as T };
}
