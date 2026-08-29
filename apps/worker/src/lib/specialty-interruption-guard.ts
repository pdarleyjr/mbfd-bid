import type { WorkerEnv } from '../types/env.js';

type NormalBidMutationGuardResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: 'specialty_adjudication_active' | 'specialty_adjudication_state_unavailable';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Keeps legacy/direct normal-bid writers from running alongside a synthetic
 * specialty interruption held by the session Durable Object. The status read
 * is deliberately fail-closed: only an explicit `active: null` permits a D1
 * mutation, so an unavailable or incompatible DO cannot split normal state.
 */
export async function guardNormalBidMutation(
  env: Pick<WorkerEnv, 'BID_SESSION'>,
  bidSessionId: string,
): Promise<NormalBidMutationGuardResult> {
  try {
    const doId = env.BID_SESSION.idFromName(bidSessionId);
    const response = await env.BID_SESSION.get(doId).fetch(
      'https://do/admin/specialty-adjudication',
    );
    if (!response.ok) {
      return { ok: false, error: 'specialty_adjudication_state_unavailable' };
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.state)) {
      return { ok: false, error: 'specialty_adjudication_state_unavailable' };
    }
    if (!Object.hasOwn(payload.state, 'active')) {
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
