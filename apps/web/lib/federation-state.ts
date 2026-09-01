export const FEDERATION_STATE_TTL_MS = 5 * 60 * 1000;

export interface FederationState {
  state: string;
  cookieValue: string;
}

export function createFederationState(nowMs = Date.now()): FederationState {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const state = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return {
    state,
    cookieValue: `${nowMs}.${state}`,
  };
}

export function validateFederationState(
  cookieValue: string | null,
  returnedState: string | null,
  nowMs = Date.now(),
): boolean {
  if (!cookieValue || !returnedState) return false;
  const separator = cookieValue.indexOf('.');
  if (separator <= 0) return false;

  const issuedAt = Number(cookieValue.slice(0, separator));
  const expected = cookieValue.slice(separator + 1);
  if (
    !Number.isSafeInteger(issuedAt) ||
    nowMs < issuedAt ||
    nowMs - issuedAt > FEDERATION_STATE_TTL_MS
  ) {
    return false;
  }
  if (expected.length !== returnedState.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ returnedState.charCodeAt(index);
  }
  return difference === 0;
}
